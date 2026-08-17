// @ts-check

// Shared plumbing for the integration tests: locating the services started by
// `compose.yaml`, resetting their state between tests, and running the script
// under test as a real child process.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Absolute path to the script under test. */
export const indexScript = fileURLToPath(new URL("../index.js", import.meta.url));

/**
 * @param {string} portVariable Environment variable holding the published port.
 * @param {string} fallback The port used by `compose.yaml` by default.
 * @returns {string}
 */
const localhost = (portVariable, fallback) =>
  `http://localhost:${process.env[portVariable] || fallback}`;

export const oxigraphUrl = localhost("OXIGRAPH_PORT", "7878");
export const varnishUrl = localhost("VARNISH_PORT", "8088");
export const minioUrl = localhost("MINIO_PORT", "9000");

export const s3Bucket = "clear-sparql-cache-test";
export const lastTimestampKey = "last_timestamp.txt";
export const simpleDateKey = "simple_date_workaround.txt";

/** Environment variables pointing the script at MinIO. */
export const s3Env = {
  S3_ENABLED: "true",
  S3_BUCKET: s3Bucket,
  S3_ACCESS_KEY_ID: "admin",
  S3_SECRET_ACCESS_KEY: "thisisasecret",
  S3_REGION: "default",
  S3_ENDPOINT: minioUrl,
  S3_SSL_ENABLED: "false",
  S3_FORCE_PATH_STYLE: "true",
};

/** Client used by the tests themselves to seed and inspect the bucket. */
export const s3Client = new S3Client({
  credentials: {
    accessKeyId: s3Env.S3_ACCESS_KEY_ID,
    secretAccessKey: s3Env.S3_SECRET_ACCESS_KEY,
  },
  region: s3Env.S3_REGION,
  endpoint: minioUrl,
  tls: false,
  forcePathStyle: true,
});

const COMPOSE_HINT = "Start the services with: docker compose up -d --wait";

/**
 * Poll an endpoint until it answers successfully.
 *
 * @param {string} name Service name, used in the error message.
 * @param {string} url The URL to poll.
 * @param {number} [timeoutMs] How long to keep trying.
 * @returns {Promise<void>}
 */
const waitFor = async (name, url, timeoutMs = 60 * 1000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never answered";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = `${error}`;
    }
    await delay(250);
  }
  throw new Error(`${name} is not reachable at ${url} (${lastError}). ${COMPOSE_HINT}`);
};

/**
 * Wait until every service the tests depend on is reachable, and make sure the
 * bucket the script writes its state to exists.
 *
 * @returns {Promise<void>}
 */
export const waitForServices = async () => {
  await waitFor("Oxigraph", `${oxigraphUrl}/query?query=ASK%20%7B%7D`);
  await waitFor("Varnish", `${varnishUrl}/query?query=ASK%20%7B%7D`);
  await waitFor("MinIO", `${minioUrl}/minio/health/live`);

  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: s3Bucket }));
  } catch (error) {
    // Every run after the first one finds the bucket already there.
    const name = /** @type {Error} */ (error).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw error;
    }
  }
};

/**
 * Replace the whole content of the triple store.
 *
 * @param {string} [turtleDocument] The Turtle to load, or nothing to just empty
 *   the store.
 * @returns {Promise<void>}
 */
export const resetStore = async (turtleDocument = "") => {
  const dropped = await fetch(`${oxigraphUrl}/update`, {
    method: "POST",
    headers: { "content-type": "application/sparql-update" },
    body: "DROP ALL",
  });
  if (!dropped.ok) {
    throw new Error(`Failed to empty the store: HTTP ${dropped.status}`);
  }

  if (!turtleDocument.trim()) {
    return;
  }

  const loaded = await fetch(`${oxigraphUrl}/store?default`, {
    method: "POST",
    headers: { "content-type": "text/turtle" },
    body: turtleDocument,
  });
  if (!loaded.ok) {
    throw new Error(`Failed to load fixtures: HTTP ${loaded.status} ${await loaded.text()}`);
  }
};

/**
 * Delete everything in the state bucket.
 *
 * @returns {Promise<void>}
 */
export const resetBucket = async () => {
  const listed = await s3Client.send(new ListObjectsV2Command({ Bucket: s3Bucket }));
  const objects = (listed.Contents || []).map(({ Key }) => ({ Key }));
  if (objects.length > 0) {
    await s3Client.send(
      new DeleteObjectsCommand({ Bucket: s3Bucket, Delete: { Objects: objects } }),
    );
  }
};

/**
 * Read an object from the state bucket.
 *
 * @param {string} key The object key.
 * @returns {Promise<string|null>} The content, or `null` if there is no such
 *   object.
 */
export const readState = async (key) => {
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    return (await object.Body?.transformToString())?.trim() ?? "";
  } catch (error) {
    if (/** @type {Error} */ (error).name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
};

/**
 * Write an object to the state bucket, to put the script in a known state
 * before it runs.
 *
 * @param {string} key The object key.
 * @param {string} body The content to write.
 * @returns {Promise<void>}
 */
export const writeState = async (key, body) => {
  await s3Client.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: body }));
};

/**
 * @typedef {object} ScriptResult
 * @property {number|null} code The exit code.
 * @property {string} stdout Everything the script wrote to stdout.
 * @property {string} stderr Everything the script wrote to stderr.
 */

/**
 * Run `index.js` as a child process.
 *
 * The script is started from an empty scratch directory so that `dotenv` cannot
 * pick up the `.env` file a developer keeps at the root of the repository: the
 * environment a test declares is the entire environment the script sees.
 *
 * @param {Record<string, string>} env The environment variables to run with.
 * @returns {Promise<ScriptResult>}
 */
export const runScript = async (env) => {
  const cwd = await mkdtemp(join(tmpdir(), "clear-sparql-cache-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [indexScript], {
        cwd,
        env: { PATH: process.env.PATH || "", TZ: "UTC", ...env },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
};

/**
 * The cache entries the script reported purging, read back from its output.
 *
 * Only the final section of the output is considered, so that the entities it
 * lists as modified beforehand are not mistaken for purged entries.
 *
 * @param {string} stdout The script output.
 * @returns {string[]}
 */
export const purgedEntries = (stdout) => {
  const [, report] = stdout.split(/^Found \d+ cache entries to clear:$/m);
  if (report === undefined) {
    throw new Error(`The script did not report any purge summary:\n${stdout}`);
  }
  return [...report.matchAll(/^ {2}- (.+) \(\d{3}\):$/gm)].map(([, entry]) => entry);
};

/**
 * Send a SPARQL query through Varnish.
 *
 * @param {string} query The SPARQL query.
 * @returns {Promise<{ status: number, cache: string|null, xkey: string|null }>}
 */
export const queryThroughCache = async (query) => {
  const response = await fetch(`${varnishUrl}/query`, {
    method: "POST",
    headers: {
      "content-type": "application/sparql-query",
      accept: "application/sparql-results+json",
    },
    body: query,
  });
  await response.arrayBuffer(); // Drain the body so the connection is reusable.
  return {
    status: response.status,
    cache: response.headers.get("x-cache"),
    xkey: response.headers.get("xkey"),
  };
};

/**
 * @typedef {object} StubCache
 * @property {string} url The endpoint to point `CACHE_ENDPOINT` at.
 * @property {{ method: string|undefined, headers: import("node:http").IncomingHttpHeaders }[]} requests
 *   The requests received so far.
 * @property {() => Promise<void>} close Shut the server down.
 */

/**
 * Start a stand-in for the cache endpoint that answers with a fixed status.
 *
 * Varnish answers `200` to every authorised xkey purge, so a stub is the only
 * way to exercise what the script does when a purge fails.
 *
 * @param {object} [options]
 * @param {number} [options.status] The status code to answer with.
 * @returns {Promise<StubCache>}
 */
export const startStubCache = async ({ status = 200 } = {}) => {
  /** @type {{ method: string|undefined, headers: import("node:http").IncomingHttpHeaders }[]} */
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, headers: req.headers });
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(`stub cache answered ${status}`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The stub cache did not get a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
};
