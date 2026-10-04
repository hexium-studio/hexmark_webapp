import { sql } from "drizzle-orm";
import { uuid } from "drizzle-orm/pg-core";

// Primary key of every table with a generated id: a UUID version 7 from
// PostgreSQL's built-in uuidv7() (PostgreSQL 18 or newer). Version 7 ids
// start with a millisecond timestamp, so new rows land at the end of the
// primary key index instead of at random places.
//
// Rows created before migration 0008 keep their version 4 ids; both versions
// live side by side in the same columns. An id is an opaque identifier: never
// read a creation time, an order or anything else out of it (use the
// timestamp columns for that).
//
// Ids generated in the application use apps/server/src/lib/uuid.ts.
export function idColumn() {
  return uuid("id").primaryKey().default(sql`uuidv7()`);
}
