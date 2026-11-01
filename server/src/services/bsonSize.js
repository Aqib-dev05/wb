// Size in bytes a JSON-like value takes once Mongo stores it (BSON). Pure, no driver needed.
//
// Why: a board's snapshot is ONE document and MongoDB refuses documents over 16 MB. BSON is far
// bigger than JSON for number-heavy data (a freehand stroke is thousands of tiny arrays: 2.2x in
// measurements), so the server tracks this size and stops accepting more content before a snapshot
// can no longer be written. Mirrors the driver's rules for the value types the op validators allow:
// strings, finite numbers, booleans, null, arrays and plain objects. tests/bsonSize.test.js checks
// it against the real BSON library.

const utf8 = (s) => Buffer.byteLength(s, 'utf8');
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/** Bytes of one element inside a document or array: type byte + key + NUL + value. */
const element = (key, value) => 1 + utf8(key) + 1 + valueSize(value);

function valueSize(v) {
  switch (typeof v) {
    case 'string':
      return 4 + utf8(v) + 1;
    case 'number':
      return Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX ? 4 : 8;
    case 'boolean':
      return 1;
    case 'object': {
      if (v === null) return 0;
      let size = 4 + 1; // length prefix + terminator
      if (Array.isArray(v)) for (let i = 0; i < v.length; i++) size += element(String(i), v[i]);
      else for (const k of Object.keys(v)) if (v[k] !== undefined) size += element(k, v[k]);
      return size;
    }
    default:
      return 0;
  }
}

export const bsonValueSize = valueSize;

/** Size of an object as a document (what Mongo reports for it). */
export const bsonSize = (doc) => valueSize(doc);

/** Bytes an element `key: value` adds to its parent document. */
export const bsonElementSize = element;
