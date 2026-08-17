// @ts-check

// Minimal stand-in for the SPARQL proxy that sits between Varnish and the
// triplestore in production. It forwards every request to Oxigraph and tags the
// response with an `xkey` header listing the IRIs mentioned in the query, plus
// the default entry name. Varnish stores those tags alongside the cached object,
// which is what makes `PURGE` with an `xkey` header able to invalidate it.
//
// This runs inside the Compose network only, and is deliberately dependency
// free so that it can be bind-mounted into a plain `node` image.

import { createServer } from "node:http";

const upstreamUrl = process.env.UPSTREAM_URL || "http://localhost:7878";
const port = Number(process.env.PORT || 3000);
const defaultTag = process.env.DEFAULT_TAG || "default";

// Hop-by-hop and body-framing headers that must not be copied verbatim, either
// because Node sets them itself or because `fetch` already decoded the body.
const skippedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

/**
 * Collect the IRIs a SPARQL query refers to, to be used as cache tags.
 *
 * Responses that cannot be attributed to any dataset fall back to the default
 * entry name, which is the tag the script clears whenever anything at all
 * changed.
 *
 * @param {string} query The SPARQL query, or anything containing IRIs.
 * @returns {string[]} The cache tags, never empty.
 */
const extractTags = (query) => {
  const tags = new Set();
  for (const [, iri] of query.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    tags.add(iri);
  }
  return tags.size > 0 ? Array.from(tags) : [defaultTag];
};

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const target = new URL(req.url || "/", upstreamUrl);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: /** @type {Record<string, string>} */ (headers),
      body: body.length > 0 ? body : undefined,
    });
    const payload = Buffer.from(await upstream.arrayBuffer());

    /** @type {Record<string, string>} */
    const responseHeaders = {};
    upstream.headers.forEach((value, name) => {
      if (!skippedResponseHeaders.has(name)) {
        responseHeaders[name] = value;
      }
    });

    // Tag the response with everything the query mentions. The query lives in
    // the body for POST requests and in the query string for GET ones.
    responseHeaders.xkey = extractTags(
      `${decodeURIComponent(target.search)} ${body.toString("utf8")}`,
    ).join(" ");

    res.writeHead(upstream.status, responseHeaders);
    res.end(payload);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Failed to reach ${upstreamUrl}: ${error}`);
  }
});

server.listen(port, () => {
  console.log(`xkey proxy listening on :${port}, forwarding to ${upstreamUrl}`);
});
