// @ts-check

// The state the script keeps in S3: the timestamp of the previous run, and the
// bookkeeping that stops a `xsd:date` from being cleared on every single run.

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { DAY, HOUR, entity, isoFromNow, turtle, utcDateFromNow } from "./fixtures/cubes.js";
import {
  lastTimestampKey,
  oxigraphUrl,
  purgedEntries,
  readState,
  resetBucket,
  resetStore,
  runScript,
  s3Env,
  simpleDateKey,
  varnishUrl,
  waitForServices,
  writeState,
} from "./helpers.js";

const CUBE = "https://example.org/cube/air-quality";

const baseEnv = {
  ...s3Env,
  SPARQL_ENDPOINT_URL: `${oxigraphUrl}/query`,
  CACHE_ENDPOINT: varnishUrl,
  CACHE_TAG_HEADER: "xkey",
  CACHE_DEFAULT_ENTRY_NAME: "default",
  SUPPORT_URL_ENCODED: "false",
};

describe("keeping the previous run timestamp in S3", () => {
  before(waitForServices);
  beforeEach(resetBucket);

  it("records when it ran, and starts from the configured date on a first run", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));
    const startedAt = Date.now();

    const { code, stdout, stderr } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    // The state files do not exist yet on a first run, and the script says so.
    assert.match(stderr, /Failed to get last timestamp from S3/);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", CUBE].sort());

    const recorded = await readState(lastTimestampKey);
    assert.ok(recorded, "no timestamp was written to S3");
    const recordedAt = new Date(recorded).getTime();
    assert.ok(
      recordedAt >= startedAt && recordedAt <= Date.now(),
      `${recorded} is not within the window the script ran in`,
    );

    assert.deepEqual(JSON.parse((await readState(simpleDateKey)) || "null"), {});
  });

  it("uses the recorded timestamp instead of the configured date on the next run", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));

    const first = await runScript({ ...baseEnv, DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR) });
    assert.equal(first.code, 0);
    assert.deepEqual(purgedEntries(first.stdout).sort(), ["default", CUBE].sort());

    // Nothing changed in between, and the cube is now older than the recorded
    // timestamp, so the second run has nothing to do — even though the
    // configured fallback date would still match it.
    const second = await runScript({ ...baseEnv, DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR) });

    assert.equal(second.code, 0);
    assert.match(second.stdout, /Last timestamp found in S3/);
    assert.deepEqual(purgedEntries(second.stdout), []);
  });

  it("falls back to the configured date when the recorded timestamp is empty", async () => {
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));
    await writeState(lastTimestampKey, "   \n");

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", CUBE].sort());
  });
});

describe("the simple date workaround", () => {
  before(waitForServices);
  beforeEach(resetBucket);

  it("clears a date-only cube once, and remembers it instead of clearing it again", async () => {
    // A `xsd:date` reaches the script as midnight, which it reads as "some time
    // today". Today is not over yet, so this is the first of the two clears.
    await resetStore(
      turtle(entity({ iri: CUBE, dateModified: utcDateFromNow(), datatype: "xsd:date" })),
    );

    const first = await runScript({ ...baseEnv, DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * DAY) });
    assert.equal(first.code, 0);
    assert.deepEqual(purgedEntries(first.stdout).sort(), ["default", CUBE].sort());

    const remembered = JSON.parse((await readState(simpleDateKey)) || "null");
    assert.deepEqual(Object.keys(remembered), [CUBE]);

    // The day still is not over, and the cube is already on the list, so a
    // second run must leave it alone rather than clearing it over and over.
    const second = await runScript({ ...baseEnv, DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * DAY) });

    assert.equal(second.code, 0);
    assert.deepEqual(purgedEntries(second.stdout), []);
    assert.deepEqual(Object.keys(JSON.parse((await readState(simpleDateKey)) || "null")), [CUBE]);
  });

  it("clears a remembered cube a second time once its day is over, then forgets it", async () => {
    // Yesterday's date, which the script reads as "the end of yesterday": that
    // moment has passed, so this is the second and final clear.
    await resetStore(
      turtle(entity({ iri: CUBE, dateModified: utcDateFromNow(-1 * DAY), datatype: "xsd:date" })),
    );
    await writeState(simpleDateKey, JSON.stringify({ [CUBE]: isoFromNow(-1 * DAY) }));

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-3 * DAY),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", CUBE].sort());
    assert.deepEqual(JSON.parse((await readState(simpleDateKey)) || "null"), {});
  });

  it("never puts a cube carrying a real dateTime on the list", async () => {
    // The counterpart of the workaround: an actual `xsd:dateTime` needs no
    // bookkeeping, because the recorded timestamp alone is enough to stop it
    // from being cleared twice.
    await resetStore(turtle(entity({ iri: CUBE, dateModified: isoFromNow(-1 * HOUR) })));

    const { code, stdout } = await runScript({
      ...baseEnv,
      DEFAULT_PREVIOUS_DATE: isoFromNow(-2 * HOUR),
    });

    assert.equal(code, 0);
    assert.deepEqual(purgedEntries(stdout).sort(), ["default", CUBE].sort());
    assert.deepEqual(JSON.parse((await readState(simpleDateKey)) || "null"), {});
  });
});
