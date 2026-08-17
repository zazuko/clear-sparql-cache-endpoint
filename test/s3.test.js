// @ts-check

// The S3 helpers in lib/s3.js, against MinIO.

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { resetBucket, s3Env, waitForServices } from "./helpers.js";

// lib/s3.js builds its client from the environment when it is first imported,
// so the configuration has to be in place before that happens.
Object.assign(process.env, s3Env);
const { getDataAsString, getObject, s3Bucket, saveObject } = await import("../lib/s3.js");

describe("lib/s3.js", () => {
  before(waitForServices);
  beforeEach(resetBucket);

  it("reads back what it saved", async () => {
    await saveObject("greeting.txt", "hello");

    const object = await getObject("greeting.txt");

    assert.equal(object.ContentType, "text/plain");
    assert.equal(await getDataAsString(object.Body), "hello");
  });

  it("stores the content type it is given", async () => {
    await saveObject("state.json", JSON.stringify({ answer: 42 }), "application/json");

    const object = await getObject("state.json");

    assert.equal(object.ContentType, "application/json");
    assert.deepEqual(JSON.parse(await getDataAsString(object.Body)), { answer: 42 });
  });

  it("overwrites an existing object", async () => {
    await saveObject("state.txt", "first");
    await saveObject("state.txt", "second");

    assert.equal(await getDataAsString((await getObject("state.txt")).Body), "second");
  });

  it("trims the surrounding whitespace unless asked not to", async () => {
    await saveObject("padded.txt", "  2024-08-19T00:00:00.000Z\n");
    const object = await getObject("padded.txt");

    assert.equal(await getDataAsString(object.Body), "2024-08-19T00:00:00.000Z");
    assert.equal(
      await getDataAsString((await getObject("padded.txt")).Body, false),
      "  2024-08-19T00:00:00.000Z\n",
    );
  });

  it("reads an empty body as an empty string", async () => {
    assert.equal(await getDataAsString(undefined), "");
  });

  it("rejects when the object does not exist", async () => {
    await assert.rejects(getObject("never-written.txt"), { name: "NoSuchKey" });
  });

  it("uses the bucket from the environment", () => {
    assert.equal(s3Bucket, s3Env.S3_BUCKET);
  });
});
