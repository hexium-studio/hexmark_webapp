import { customType } from "drizzle-orm/pg-core";

// PostgreSQL full-text search document. Drizzle has no built-in type for it;
// the application never reads the raw value, it only queries against it
// (to_tsquery, ts_rank, ts_headline), so it is typed as an opaque string.
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
