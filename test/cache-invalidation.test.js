// @ts-check

// What running the script actually does to Varnish: cached responses tagged
// with a modified dataset have to be gone afterwards, and the others have to
// survive.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { DAY, HOUR, entity, hasParts, isoFromNow, turtle } from "./fixtures/cubes.js";
import {
  oxigraphUrl,
  queryThroughCache,
  resetStore,
  runScript,
  varnishUrl,
  waitForServices,
} from "./helpers.js";

const MODIFIED_CUBE = "https://example.org/cube/air-quality";
const UNTOUCHED_CUBE = "https://example.org/cube/population";

const baseEnv = {
  SPARQL_ENDPOINT_URL: `${oxigraphUrl}/query`,
  CACHE_ENDPOINT: varnishUrl,
  CACHE_TAG_HEADER: "xkey",
  CACHE_DEFAULT_ENTRY_NAME: "default",
  S3_ENABLED: "false",
};

/** A query the proxy tags with the given cube, so Varnish can purge it by IRI. */
const queryAbout = (cube) => `SELECT * WHERE { <${cube}> ?predicate ?object }`;

/** A query mentioning no dataset, which the proxy tags as the default entry. */
const queryAboutNothing = () => "SELECT * WHERE { ?subject ?predicate ?object } LIMIT 1";

/**
 * Run a query twice so that it is cached, and assert Varnish agrees.
 *
 * @param {string} query The SPARQL query to warm up.
 * @returns {Promise<void>}
 */
const warmUp = async (query) => {
  const first = await queryThroughCache(query);
  assert.equal(first.status, 200);

  const second = await queryThroughCache(query);
  assert.equal(second.cache, "HIT", `Varnish did not cache: ${query}`);
};

describe("invalidating cached responses in Varnish", () => {
  before(waitForServices);

  it("drops the entries of modified cubes and keeps the others", async () => {
    await resetStore(
      turtle(
        entity({ iri: MODIFIED_CUBE, dateModified: isoFromNow(-1 * HOUR) }),
        entity({ iri: UNTOUCHED_CUBE, dateModified: isoFromNow(-30 * DAY) }),
      ),
    );

    // Three distinct cached responses: one per cube, plus one that cannot be
    // attributed to any dataset and is therefore tagged as the default entry.
    await warmUp(queryAbout(MODIFIED_CUBE));
    await warmUp(queryAbout(UNTOUCHED_CUBE));
    await warmUp(queryAboutNothing());

    const { code } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });
    assert.equal(code, 0);

    const modified = await queryThroughCache(queryAbout(MODIFIED_CUBE));
    assert.equal(modified.cache, "MISS", "the modified cube was still served from cache");

    const untouched = await queryThroughCache(queryAbout(UNTOUCHED_CUBE));
    assert.equal(untouched.cache, "HIT", "an unrelated cube was evicted from the cache");

    const unattributed = await queryThroughCache(queryAboutNothing());
    assert.equal(unattributed.cache, "MISS", "the default entry was not cleared");
  });

  it("leaves the cache untouched when nothing was modified", async () => {
    await resetStore(
      turtle(
        entity({ iri: MODIFIED_CUBE, dateModified: isoFromNow(-30 * DAY) }),
        entity({ iri: UNTOUCHED_CUBE, dateModified: isoFromNow(-30 * DAY) }),
      ),
    );

    await warmUp(queryAbout(MODIFIED_CUBE));
    await warmUp(queryAboutNothing());

    const { code } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-1 * HOUR),
    });
    assert.equal(code, 0);

    const cube = await queryThroughCache(queryAbout(MODIFIED_CUBE));
    assert.equal(cube.cache, "HIT");

    const unattributed = await queryThroughCache(queryAboutNothing());
    assert.equal(unattributed.cache, "HIT");
  });

  it("drops the cached responses of older versions when a new one is published", async () => {
    const version1 = `${MODIFIED_CUBE}/1`;
    const version2 = `${MODIFIED_CUBE}/2`;
    await resetStore(
      turtle(
        hasParts(MODIFIED_CUBE, [version1, version2]),
        entity({ iri: version1, dateModified: isoFromNow(-30 * DAY) }),
        entity({ iri: version2, dateModified: isoFromNow(-1 * HOUR) }),
        entity({ iri: UNTOUCHED_CUBE, dateModified: isoFromNow(-30 * DAY) }),
      ),
    );

    await warmUp(queryAbout(version1));
    await warmUp(queryAbout(UNTOUCHED_CUBE));

    const { code } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });
    assert.equal(code, 0);

    // Version 1 was not modified itself, but a sibling version was, so its
    // cached response has to go as well.
    const previousVersion = await queryThroughCache(queryAbout(version1));
    assert.equal(previousVersion.cache, "MISS", "the previous version stayed in the cache");

    const untouched = await queryThroughCache(queryAbout(UNTOUCHED_CUBE));
    assert.equal(untouched.cache, "HIT", "an unrelated cube was evicted from the cache");
  });
});
