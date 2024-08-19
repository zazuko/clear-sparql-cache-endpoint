// @ts-check

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * The S3 bucket to use.
 * @type {string}
 * @default "default"
 */
export const s3Bucket = `${process.env.S3_BUCKET || "default"}`;

/**
 * The S3 client.
 * @type {S3Client}
 */
export const s3Client = new S3Client({
  credentials: {
    accessKeyId: `${process.env.S3_ACCESS_KEY_ID}` || "",
    secretAccessKey: `${process.env.S3_SECRET_ACCESS_KEY}` || "",
  },
  region: `${process.env.S3_REGION}` || "default",
  endpoint: `${process.env.S3_ENDPOINT}`,
  tls: process.env.S3_SSL_ENABLED === "true",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

/**
 * Get an object from S3.
 *
 * @param {string} key The key of the object to get.
 * @returns {Promise<import('@aws-sdk/client-s3').GetObjectCommandOutput>}
 */
export const getObject = async (key) => {
  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: key,
  });
  return s3Client.send(command);
};

/**
 * Get the data from an S3 object as a string.
 *
 * @param {import('@aws-sdk/client-s3').GetObjectCommandOutput["Body"]} body The body to get the data from.
 * @param {boolean} [trim=true] Whether to trim the string.
 * @returns {Promise<string>}
 */
export const getDataAsString = async (body, trim = true) => {
  if (!body) {
    return "";
  }
  const bodyAsString = await body.transformToString();
  return trim ? bodyAsString.trim() : bodyAsString;
};

/**
 * Save an object to S3.
 *
 * @param {string} key The key of the object to save.
 * @param {string} body The body of the object to save.
 * @param {string} [contentType="text/plain"] The content type of the object to save.
 * @returns {Promise<import('@aws-sdk/client-s3').PutObjectCommandOutput>}
 */
export const saveObject = async (key, body, contentType = "text/plain") => {
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  return s3Client.send(command);
};
