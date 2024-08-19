import "dotenv/config";
import { ParsingClient } from "sparql-http-client";

// Get the date 1 day ago (this is the default value if no date is provided)
const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24);
const yesterdayStr = yesterday.toISOString();

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
const previousDateStr = process.env.DEFAULT_PREVIOUS_DATE || yesterdayStr; // 1 day ago
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
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
  PREFIX cube:   <https://cube.link/>
  PREFIX schema: <http://schema.org/>
  PREFIX rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
  PREFIX void:   <http://rdfs.org/ns/void#>
  PREFIX dcat:   <http://www.w3.org/ns/dcat#>

  SELECT DISTINCT ?dataset ?dateModified WHERE {
    {
      SELECT DISTINCT ?dataset WHERE {
        # Get all cubes and datasets
        VALUES ?type { cube:Cube void:Dataset }
        ?entity a ?type .

        # Get other versions of the cube if they exist
        OPTIONAL {
          ?entity ^schema:hasPart ?parent.
          ?parent schema:hasPart ?version.
        }

        # Return versions else fallback to dataset
        BIND(COALESCE(?version, ?entity) AS ?dataset)
      }
    }

    # Make sure they have a dateModified field
    ?dataset schema:dateModified ?dateModified.
  }

  ORDER BY DESC(STR(?dateModified))
`);

const entriesToClear = new Set();

console.log(`Checking for cubes modified after ${previousDate.toISOString()}:`);
for (const cube of modifiedCubes) {
  const dateModified = cube.dateModified;
  const modifiedDate = new Date(dateModified.value);
  // const modifiedDateDataType = dateModified.datatype.value;
  // const isDateTime = modifiedDateDataType.includes('dateTime');

  if (modifiedDate >= previousDate) {
    entriesToClear.add(cube.dataset.value);
    if (supportUrlEncoded === "true") {
      entriesToClear.add(encodeURI(cube.dataset.value));
      entriesToClear.add(encodeURIComponent(cube.dataset.value));
    }
    entriesToClear.add(cacheDefaultEntryName);
    console.log(`  - ${cube.dataset.value} was last modified on ${modifiedDate.toISOString()}`);
  }
}

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

// Return the right status code
const failedPromises = promises.filter((p) => p.status === "rejected");
if (failedPromises.length > 0) {
  console.error(`\nFailed to clear ${failedPromises.length} cache entries`);
  process.exit(1);
}
