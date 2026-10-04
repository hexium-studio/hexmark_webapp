// UUID version 7 (RFC 9562, section 5.7) for ids the application creates
// itself, matching what PostgreSQL's uuidv7() gives rows (see
// src/db/schema/id-column.ts):
//
//   48 bits  Unix time in milliseconds
//    4 bits  version (0111)
//   12 bits  counter (rand_a, RFC 9562 section 6.2 method 1)
//    2 bits  variant (10)
//   62 bits  random (crypto.getRandomValues)
//
// Within one process the ids are strictly increasing: a call in the same
// millisecond as the previous one increments the counter. The counter starts
// at a random value below 2048, so at least 2048 ids fit into one millisecond;
// beyond that, or when the system clock goes backwards, the timestamp is
// carried forward by one millisecond instead of repeating an id.
//
// Callers must treat the result as opaque; nothing may depend on reading the
// time or order back out of an id.

const MAX_COUNTER = 0xfff;
const COUNTER_SEED_MASK = 0x7ff;

let lastMs = -1;
let counter = 0;

function randomCounterSeed(): number {
  const [value = 0] = crypto.getRandomValues(new Uint16Array(1));
  return value & COUNTER_SEED_MASK;
}

function nextTimestamp(): number {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = randomCounterSeed();
  } else if (counter < MAX_COUNTER) {
    counter += 1;
  } else {
    lastMs += 1;
    counter = randomCounterSeed();
  }
  return lastMs;
}

export function uuidv7(): string {
  const ms = nextTimestamp();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // 48-bit timestamp, big-endian (above 2^32, so no bit operators).
  for (let i = 5, rest = ms; i >= 0; i -= 1, rest = Math.floor(rest / 256)) {
    bytes[i] = rest % 256;
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
