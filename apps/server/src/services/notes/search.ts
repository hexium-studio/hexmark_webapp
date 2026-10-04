import type { SearchHit } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { SNIPPET_FRAGMENT_DELIMITER, SNIPPET_OPTIONS } from "../../config/notes";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { canSeeFolder, visibleFolderSql } from "../access/authorize";
import { missingFolder } from "../trash/in-trash";
import { unmarkCompoundParts } from "./compound-marks";
import { folderSubtreeIds } from "./folder-index";
import { withRead } from "./read-frame";
import { refuse } from "./refusals";
import { finishSnippet, relativeRanks } from "./snippets";

// Full-text search per section: web search syntax ("phrase", or, -word) with
// the 'simple' configuration (no stemming, so every language works the same),
// ranked with ts_rank (answered relative to the best hit). The snippet is cut
// from the section's own text without its heading line (snippets.ts
// finishes it, after compound-marks.ts took off the marks of a hyphenated
// word's parts), which comes as a field of its own, as written: no marks, so
// it can be compared with the outline's headings.

interface HitRow extends Record<string, unknown> {
  note_id: string;
  title: string;
  folder_id: string | null;
  path: string;
  heading: string;
  version: number;
  rank: number;
  snippet: string;
  text: string;
}

// The heading line of a section's own text: one line for "# Heading", two
// for an underlined (Setext) heading. The introduction (level 0) has none.
const HEADING_LINES = sql`case when s.level = 0 then 0
  when substr(n.body, s.start_offset + 1, 4) ~ '^ {0,3}#' then 1 else 2 end`;

export function searchNotes(
  ref: AccessRef,
  now: Date,
  input: { query: string; folderId: string | null; limit: number },
): Promise<Outcome<SearchHit[]>> {
  const request = { ref, now, permission: "search", action: "read.search", input } as const;
  return withRead(
    request,
    async ({ tx, grant, index }) => {
      let within = sql`true`;
      if (input.folderId !== null) {
        if (!index.get(input.folderId)) return missingFolder(tx, grant, input.folderId);
        if (!canSeeFolder(grant, input.folderId)) return refuse("folder_not_found");
        const ids = await folderSubtreeIds(tx, [input.folderId]);
        within = sql`n.folder_id = any(${sql.param(ids)}::uuid[])`;
      }
      // Hits first, snippets only for the ones returned.
      const rows = await tx.execute<HitRow>(sql`
      select hit.note_id, hit.title, hit.folder_id, hit.path, hit.version, hit.rank, hit.text,
        hit.heading,
        ts_headline('simple', hit.text, hit.query, ${SNIPPET_OPTIONS}) as snippet
      from (
        select s.note_id, n.title, n.folder_id, s.path, s.heading, n.version, q.query,
          ts_rank(s.search, q.query)::float8 as rank,
          regexp_replace(substr(n.body, s.start_offset + 1, s.end_offset - s.start_offset),
            '^([^\n]*(\n|$)){' || ${HEADING_LINES} || '}', '') as text
        from note_sections s
        join notes n on n.id = s.note_id
        cross join websearch_to_tsquery('simple', ${input.query}) as q(query)
        where s.search @@ q.query and n.deleted_at is null
          and ${visibleFolderSql(grant, sql`n.folder_id`)} and ${within}
        order by rank desc, n.updated_at desc, s.position
        limit ${input.limit}
      ) hit
      order by hit.rank desc
    `);
      const ranks = relativeRanks(rows.map((row) => Number(row.rank)));
      return rows.map((row, position) => ({
        noteId: row.note_id,
        title: row.title,
        folderId: row.folder_id,
        folderPath: index.pathOf(row.folder_id),
        sectionPath: row.path,
        heading: row.heading,
        snippet: finishSnippet(
          unmarkCompoundParts(row.snippet, input.query),
          row.text,
          SNIPPET_FRAGMENT_DELIMITER,
        ),
        version: row.version,
        rank: ranks[position] ?? 0,
      }));
    },
    (hits) => ({ details: { hitCount: hits.length } }),
  );
}
