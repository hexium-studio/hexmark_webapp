import { noteViewQuerySchema } from "@hexmark/shared";
import type { Context } from "hono";
import type { Outcome } from "../../../../lib/outcome";
import { readFullNote, readOutline, readSection } from "../../../../services/notes/note-reads";
import { handle } from "../../_lib/request";

// GET /api/notes/v1/notes/:id – see ../index.ts for the contract.
export function getNote(c: Context): Promise<Response> {
  const note = { id: c.req.param("id") ?? "" };
  // Which read, for logging input the query check refuses.
  const view = c.req.query("view");
  const action =
    view === "outline" ? "read.outline" : view === "section" ? "read.section" : "read.note";
  return handle(
    c,
    action,
    { query: noteViewQuerySchema },
    async (ref, query, now): Promise<Outcome<object>> => {
      if (query.view === "outline") return readOutline(ref, now, note);
      if (query.view === "section") {
        return readSection(ref, now, note, {
          path: query.section ?? "",
          includeSubsections: query.subsections,
          offset: query.offset,
          limit: query.limit,
        });
      }
      const outcome = await readFullNote(ref, now, note);
      return outcome.ok ? { ok: true, value: { note: outcome.value } } : outcome;
    },
  );
}
