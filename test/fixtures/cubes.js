// @ts-check

// Turtle builders for the cubes and datasets the script looks for. Timestamps
// are always computed relative to the moment the test runs, so that a fixture
// can be "modified an hour ago" without pinning the suite to a wall-clock date.

const PREFIXES = `
@prefix cube:   <https://cube.link/> .
@prefix schema: <http://schema.org/> .
@prefix void:   <http://rdfs.org/ns/void#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
`;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * An ISO 8601 timestamp offset from now.
 *
 * @param {number} [offsetMs] Milliseconds to add to the current time.
 * @returns {string}
 */
export const isoFromNow = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/**
 * A `YYYY-MM-DD` date in UTC, offset from now.
 *
 * The script runs with `TZ=UTC`, so a UTC date is what makes its "this looks
 * like an `xsd:date` promoted to midnight" detection deterministic.
 *
 * @param {number} [offsetMs] Milliseconds to add to the current time.
 * @returns {string}
 */
export const utcDateFromNow = (offsetMs = 0) => isoFromNow(offsetMs).slice(0, 10);

/**
 * Turtle for an entity carrying a `schema:dateModified`.
 *
 * @param {object} options
 * @param {string} options.iri The entity IRI.
 * @param {string} options.dateModified The literal value.
 * @param {string} [options.datatype] The literal datatype, or `""` for a plain
 *   literal, which is how a value the query cannot read as a date is written.
 * @param {string} [options.type] The RDF type, `cube:Cube` or `void:Dataset`.
 * @returns {string}
 */
export const entity = ({ iri, dateModified, datatype = "xsd:dateTime", type = "cube:Cube" }) => {
  const literal = datatype ? `"${dateModified}"^^${datatype}` : `"${dateModified}"`;
  return `<${iri}> a ${type} ; schema:dateModified ${literal} .`;
};

/**
 * Turtle linking several versions of a cube to a common parent, which is how
 * the query finds the older versions that also need their cache cleared.
 *
 * @param {string} parent The parent IRI.
 * @param {string[]} parts The version IRIs.
 * @returns {string}
 */
export const hasParts = (parent, parts) =>
  `<${parent}> schema:hasPart ${parts.map((part) => `<${part}>`).join(", ")} .`;

/**
 * Assemble Turtle statements into a document.
 *
 * @param {...string} statements
 * @returns {string}
 */
export const turtle = (...statements) => `${PREFIXES}\n${statements.join("\n")}\n`;
