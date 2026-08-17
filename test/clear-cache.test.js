// @ts-check

// Which cache entries the script decides to clear, given what the SPARQL
// endpoint reports as modified. Every run goes through the real Varnish.

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { DAY, HOUR, entity, hasParts, isoFromNow, turtle } from "./fixtures/cubes.js";
import {
  oxigraphUrl,
  purgedEntries,
  resetStore,
  runScript,
  startStubCache,
  varnishUrl,
  waitForServices,
} from "./helpers.js";

const CUBE = "https://example.org/cube/air-quality";
const OTHER_CUBE = "https://example.org/cube/population";
const DATASET = "https://example.org/dataset/energy";

/** The environment shared by every run, with the S3 state disabled. */
const baseEnv = {
  SPARQL_ENDPOINT_URL: `${oxigraphUrl}/query`,
  CACHE_ENDPOINT: varnishUrl,
  CACHE_TAG_HEADER: "xkey",
  CACHE_DEFAULT_ENTRY_NAME: "default",
  S3_ENABLED: "false",
};

describe("clearing the cache of modified cubes", () => {
  before(waitForServices);

  it("purges a modified cube, its URL-encoded form and the default entry", async () => {
    await resetStore(
      turtle(
        entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) }),
        entity({ iri: OTHER_CUBE, dateModified: isoFromNow(-30 * DAY) }),
      ),
    );

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), [
      "default",
      encodeURIComponent(CUBE),
      CUBE,
    ].sort());
  });

  it("purges nothing when no cube changed since the previous run", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-30 * DAY) })));

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-1 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout), []);
    assert.match(stdout, /Found 0 cache entries to clear/);
  });

  it("leaves out the URL-encoded forms when SUPPORT_URL_ENCODED is false", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));

    const { code, stdout } = await runScript({
      ...baseEnv,
      SUPPORT_URL_ENCODED: "false",
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", CUBE].sort());
  });

  it("purges void:Dataset entities as well as cubes", async () => {
    await resetStore(
      turtle(
        entity({ iri: DATASET, dateModified: isoFromNow(-1 * HOUR), type: "void:Dataset" }),
      ),
    );

    const { code, stdout } = await runScript({
      ...baseEnv,
      SUPPORT_URL_ENCODED: "false",
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", DATASET].sort());
  });

  it("purges the older versions of a cube when a newer one is published", async () => {
    // Both versions hang off the same parent, so publishing v2 has to clear the
    // cache of v1 too: a query for v1 may well have been answered from a listing
    // that just changed.
    const v1 = `${CUBE}/1`;
    const v2 = `${CUBE}/2`;
    await resetStore(
      turtle(
        hasParts(CUBE, [v1, v2]),
        entity({ iri: v1, dateModified: isoFromNow(-30 * DAY) }),
        entity({ iri: v2, dateModified: isoFromNow(-1 * HOUR) }),
      ),
    );

    const { code, stdout } = await runScript({
      ...baseEnv,
      SUPPORT_URL_ENCODED: "false",
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", v1, v2].sort());
  });

  it("skips entities whose dateModified cannot be read as a dateTime", async () => {
    await resetStore(
      turtle(entity({ iri: CUBE, dateModified: "last thursday", datatype: "" })),
    );

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.match(stdout, new RegExp(`${CUBE} has no dateModified value, skipping`));
    assert.deepEqual(purgedEntries(stdout), []);
  });

  it("sends the entry to purge in the configured cache tag header", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));
    const cache = await startStubCache();

    try {
      const { code } = await runScript({
        ...baseEnv,
        CACHE_ENDPOINT: cache.url,
        CACHE_TAG_HEADER: "x-custom-tag",
        SUPPORT_URL_ENCODED: "false",
        DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
      });

      assert.equal(code, 0);
      assert.deepEqual(
        cache.requests.map(({ method }) => method),
        ["PURGE", "PURGE"],
      );
      assert.deepEqual(
        cache.requests.map(({ headers }) => headers["x-custom-tag"]).sort(),
        ["default", CUBE].sort(),
      );
    } finally {
      await cache.close();
    }
  });

  it("authenticates against the cache endpoint when credentials are configured", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));
    const cache = await startStubCache();

    try {
      await runScript({
        ...baseEnv,
        CACHE_ENDPOINT: cache.url,
        CACHE_ENDPOINT_USERNAME: "varnish",
        CACHE_ENDPOINT_PASSWORD: "s3cret",
        SUPPORT_URL_ENCODED: "false",
        DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
      });

      const expected = `Basic ${Buffer.from("varnish:s3cret").toString("base64")}`;
      assert.ok(cache.requests.length > 0);
      for (const { headers } of cache.requests) {
        assert.equal(headers.authorization, expected);
      }
    } finally {
      await cache.close();
    }
  });

  it("exits with a failure when the cache endpoint rejects a purge", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));
    const cache = await startStubCache({ status: 500 });

    try {
      const { code, stderr } = await runScript({
        ...baseEnv,
        CACHE_ENDPOINT: cache.url,
        SUPPORT_URL_ENCODED: "false",
        DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
      });

      assert.equal(code, 1);
      assert.match(stderr, /Failed to clear 2 cache entries/);
    } finally {
      await cache.close();
    }
  });
});

describe("configuration errors", () => {
  before(waitForServices);
  beforeEach(() => resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) }))));

  it("refuses to run without a cache endpoint", async () => {
    const { code, stderr } = await runScript({
      ...baseEnv,
      CACHE_ENDPOINT: "",
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /CACHE_ENDPOINT is required/);
  });

  it("refuses to run without a SPARQL endpoint", async () => {
    const { code, stderr } = await runScript({
      ...baseEnv,
      SPARQL_ENDPOINT_URL: "",
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /SPARQL_ENDPOINT_URL is required/);
  });
});
