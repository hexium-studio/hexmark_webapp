import { replaceSectionInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { replaceSection } from "../../../../services/notes/note-edits";
import { handle } from "../../_lib/request";

// PUT /api/notes/v1/notes/:id/sections – see ../index.ts for the contract.
export function putSection(c: Context): Promise<Response> {
  return handle(
    c,
    "note.section_replaced",
    { body: replaceSectionInputSchema },
    (ref, input, now) =>
      replaceSection(
        ref,
        now,
        { id: c.req.param("id") ?? "" },
        { ...input, section: input.heading },
      ),
  );
}
