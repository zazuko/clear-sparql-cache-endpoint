// @ts-check

import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { ParsingClient } from "sparql-http-client";
const { getObject, getDataAsString, saveObject } = await import("./lib/s3.js");

const currentDateTime = new Date();
const currentDateTimeStr = currentDateTime.toISOString();

// Get the date 1 day ago (this is the default value if no date is provided)
const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24);
const yesterdayStr = yesterday.toISOString();

// S3 configuration
const s3Enabled = process.env.S3_ENABLED === "true"; // Default to false
const s3LastTimestampKey = process.env.S3_LAST_TIMESTAMP_KEY || "last_timestamp.txt";
const s3SimpleDateWorkaroundKey = process.env.S3_SIMPLE_DATE_WORKAROUND_KEY || "simple_date_workaround.txt";

// Cache entry name for unnamed cache entries ; it will be cleared if any of the named cache entries are cleared
const cacheEndpoint = process.env.CACHE_ENDPOINT || "";
const cacheEndpointUsername = process.env.CACHE_ENDPOINT_USERNAME || "";
const cacheEndpointPassword = process.env.CACHE_ENDPOINT_PASSWORD || "";
const cacheDefaultEntryName = process.env.CACHE_DEFAULT_ENTRY_NAME || "default";
const cacheTagHeader = process.env.CACHE_TAG_HEADER || "xkey";

// This tells the script to also clear the cache for the URL-encoded version of the dataset URI
const supportUrlEncoded = process.env.SUPPORT_URL_ENCODED || "true";

// SPARQL endpoint configuration
const sparqlEndpointUrl = process.env.SPARQL_ENDPOINT_URL || "";
const sparqlUsername = process.env.SPARQL_USERNAME || "";
const sparqlPassword = process.env.SPARQL_PASSWORD || "";

// Get the date to compare with
let previousDateStr = process.env.DEFAULT_PREVIOUS_DATE || yesterdayStr; // 1 day ago
let simpleDateData = {};
if (s3Enabled) {
  try {
    const lastTimestamp = await getObject(s3LastTimestampKey);
    const trimmedLastTimestamp = await getDataAsString(lastTimestamp.Body, true);
    if (trimmedLastTimestamp) {
      console.log(`Last timestamp found in S3: ${trimmedLastTimestamp}`);
      previousDateStr = trimmedLastTimestamp;
    }
  } catch (error) {
    console.error(`Failed to get last timestamp from S3: ${error}`);
  }

  try {
    const simpleDateObject = await getObject(s3SimpleDateWorkaroundKey);
    const simpleDateDataTrimmed = await getDataAsString(simpleDateObject.Body, true);
    simpleDateData = JSON.parse(simpleDateDataTrimmed);
    console.log("Simple date workaround data found in S3:");
    console.log(simpleDateData);
  } catch (error) {
    console.error(`Failed to get simple date workaround from S3: ${error}`);
  }
}
const previousDate = new Date(previousDateStr);

// Tell the user that some required environment variables are missing
if (!cacheEndpoint) {
  throw new Error("CACHE_ENDPOINT is required");
}
if (!sparqlEndpointUrl) {
  throw new Error("SPARQL_ENDPOINT_URL is required");
}

// Create authorization headers if username and password are provided for the cache endpoint
const cacheEndpointHeaders = {};
if (cacheEndpointUsername && cacheEndpointPassword) {
  const basicCredentials = Buffer.from(`${cacheEndpointUsername}:${cacheEndpointPassword}`).toString("base64");
  cacheEndpointHeaders["Authorization"] = `Basic ${basicCredentials}`;
}

// Create the SPARQL client
const clientOptions = { endpointUrl: sparqlEndpointUrl };
if (sparqlUsername && sparqlPassword) {
  clientOptions.user = sparqlUsername;
  clientOptions.password = sparqlPassword;
}
const client = new ParsingClient(clientOptions);

// Get all cubes and datasets and their versions that have been modified
const modifiedCubes = await client.query.select(`
  PREFIX xsd:    <http://www.w3.org/2001/XMLSchema#>
  PREFIX cube:   <https://cube.link/>
  PREFIX schema: <http://schema.org/>
  PREFIX void:   <http://rdfs.org/ns/void#>

  SELECT DISTINCT ?dataset (MAX(xsd:dateTime(?dateModified)) AS ?lastModified) WHERE {
    # Get all cubes and datasets
    VALUES ?type { cube:Cube void:Dataset }
    ?entity a ?type .

    # with their timestamp on dateModified
    ?entity schema:dateModified ?dateModified.

    # Get previous versions of the cube if such exist
    OPTIONAL
    {
      # Other versions of the cube
      ?entity ^schema:hasPart ?parent.
      ?parent schema:hasPart ?previousInclCurrent.

      # Ensure other cube version is of same type
      ?previousInclCurrent a ?type .

      # Ensure other cube version cube has "schema: dateModified"
      ?previousInclCurrent schema:dateModified ?previousInclCurrentDateModified.

      # Ensure previous or current version based on timestamp !!explicitly convert to datetime, in case mixed types occur!!
      FILTER(xsd:dateTime(?previousInclCurrentDateModified) <= xsd:dateTime(?dateModified))
    }

    # Return versions else fallback to dataset
    BIND(COALESCE(?previousInclCurrent, ?entity) AS ?dataset)
  }
  GROUP BY ?dataset
  ORDER BY DESC(STR(?lastModified))
`);

const entriesToClear = new Set();

/**
 * Add an entry to the list of entries to clear, and add the URL-encoded versions if needed.
 * @param {string} entry The entry to add.
 */
const addEntryToClear = (entry) => {
  entriesToClear.add(entry);
  if (supportUrlEncoded === "true") {
    entriesToClear.add(encodeURI(entry));
    entriesToClear.add(encodeURIComponent(entry));
  }
};

console.log(`\nChecking for cubes modified after ${previousDate.toISOString()}:`);
for (const cube of modifiedCubes) {
  const datasetValue = cube.dataset.value;
  const dateModified = cube.lastModified;
  if (!dateModified) {
    console.log(`  - ${datasetValue} has no dateModified value, skipping…`);
    continue;
  }
  let modifiedDate = new Date(dateModified.value);

  // @ts-ignore (cause: types are broken --")
  const modifiedDateDataType = dateModified.datatype.value;
  const isDateTime = modifiedDateDataType.includes("dateTime");
  if (!isDateTime) {
    console.log(`  - ${datasetValue} don't have a dateTime value, skipping…`);
    continue;
  }

  // Check if it could be a dateTime generated from a date
  let convertedFromDate = false;
  if (modifiedDate.getHours() === 0 && modifiedDate.getMinutes() === 0 && modifiedDate.getSeconds() === 0) {
    // Add 1d-1ms to the date if it's a date
    modifiedDate = new Date(modifiedDate.getTime() + (1000 * 60 * 60 * 24 - 1));
    convertedFromDate = true;
  }

  if (modifiedDate >= previousDate) {
    let toClear = false;
    if (convertedFromDate) {
      // Case: it's the first time we saw this entry, and the modifiedDate is set in the future
      if (!simpleDateData[datasetValue] && currentDateTime <= modifiedDate) {
        simpleDateData[datasetValue] = currentDateTimeStr; // So that we know when we first cleared it
        addEntryToClear(datasetValue);
        toClear = true;
      }

      // Case: we already saw this entry in a past run, we clear it a second time and remove it from the list
      if (currentDateTime > modifiedDate) {
        if (simpleDateData[datasetValue]) {
          delete simpleDateData[datasetValue];
        }
        addEntryToClear(datasetValue);
        toClear = true;
      }
      // It is a dateTime
    } else {
      addEntryToClear(datasetValue);
      toClear = true;
    }
    if (toClear) {
      console.log(`  - ${datasetValue} was last modified on ${modifiedDate.toISOString()}`);
    }
  }
}

// Handle the case where we clear the default cache key
if (entriesToClear.size > 0) {
  entriesToClear.add(cacheDefaultEntryName);
}

// Purge the cache entries that need to be cleared
console.log(`\nFound ${entriesToClear.size} cache entries to clear:`);
const entriesToClearArray = Array.from(entriesToClear);
const promises = await Promise.allSettled(entriesToClearArray.map(async (entry) => {
  const results = await fetch(cacheEndpoint, {
    method: "PURGE",
    headers: {
      ...cacheEndpointHeaders,
      [cacheTagHeader]: entry,
    },
    redirect: "follow",
  });
  const body = await results.text();
  console.log(`  - ${entry} (${results.status}):\n${body}`);
  if (results.status !== 200) {
    throw new Error(`Failed to clear cache entry ${entry}`);
  }
}));

// Update the last timestamp in the S3 bucket
if (s3Enabled) {
  await saveObject(s3LastTimestampKey, currentDateTimeStr, "text/plain");
  await saveObject(s3SimpleDateWorkaroundKey, JSON.stringify(simpleDateData, null, 2), "application/json");
}

// Return the right status code
const failedPromises = promises.filter((p) => p.status === "rejected");
if (failedPromises.length > 0) {
  console.error(`\nFailed to clear ${failedPromises.length} cache entries`);
  process.exit(1);
}
