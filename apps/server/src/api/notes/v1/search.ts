import { searchQueryParamsSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { searchNotes } from "../../../services/notes/search";
import { handle } from "../_lib/request";

// GET /api/notes/v1/search – see index.ts for the contract.
export function getSearch(c: Context): Promise<Response> {
  return handle(c, "read.search", { query: searchQueryParamsSchema }, async (ref, query, now) => {
    const input = { query: query.q, folderId: query.folder ?? null, limit: query.limit };
    const outcome = await searchNotes(ref, now, input);
    return outcome.ok ? { ok: true, value: { hits: outcome.value } } : outcome;
  });
}
