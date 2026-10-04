import type { SearchHit } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { SNIPPET_FRAGMENT_DELIMITER, SNIPPET_OPTIONS } from "../../config/notes";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { hiddenRefusal, noteHiddenState } from "../hidden/hidden-state";
import { isAgent } from "../locks/lock-guard";
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
// it can be compared with the outline's headings. Only notes the caller holds
// search on are searched (a note listed on its own with read counts,
// services/access/policy.ts). For an agent, nothing below a hidden folder is
// searched (it does not exist for it) and a hidden note is found by its
// title alone: one hit without section, heading or snippet, never by its
// headings or text. Searching inside a hidden folder is refused with hidden.

interface HitRow extends Record<string, unknown> {
  note_id: string;
  title: string;
  folder_id: string | null;
  // Null for a hit on a hidden note's title (agents).
  path: string | null;
  heading: string | null;
  version: number;
  rank: number;
  snippet: string;
  text: string;
  hidden_at: Date | string | null;
  hidden_by_name: string | null;
  hide_reason: string | null;
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
        const folder = index.get(input.folderId);
        if (!folder) return missingFolder(tx, grant, input.folderId);
        if (!grant.view.seesFolder(input.folderId)) return refuse("folder_not_found");
        if (folder.hidden && isAgent(grant)) {
          const item = { kind: "folder" as const, id: folder.id, path: index.pathOf(folder.id) };
          return hiddenRefusal(item, folder.hidden);
        }
        const ids = await folderSubtreeIds(tx, [input.folderId]);
        within = sql`n.folder_id = any(${sql.param(ids)}::uuid[])`;
      }
      const visible = grant.view.noteSql("search", sql`n.id`, sql`n.folder_id`);
      // Agents: sections of notes that are not hidden; titles of those that are.
      const agent = isAgent(grant);
      const open = agent ? sql`n.hidden_at is null` : sql`true`;
      const titleOnly = agent ? sql`n.hidden_at is not null` : sql`false`;
      const query = sql`websearch_to_tsquery('simple', ${input.query}) as q(query)`;
      // Hits first, snippets only for the ones returned.
      const rows = await tx.execute<HitRow>(sql`
      select hit.note_id, hit.title, hit.folder_id, hit.path, hit.version, hit.rank, hit.text,
        hit.heading, hit.hidden_at, hit.hidden_by_name, hit.hide_reason,
        case when hit.path is null then ''
          else ts_headline('simple', hit.text, hit.query, ${SNIPPET_OPTIONS}) end as snippet
      from (
        (select s.note_id, n.title, n.folder_id, s.path, s.heading, n.version, q.query,
          ts_rank(s.search, q.query)::float8 as rank,
          regexp_replace(substr(n.body, s.start_offset + 1, s.end_offset - s.start_offset),
            '^([^\n]*(\n|$)){' || ${HEADING_LINES} || '}', '') as text,
          n.hidden_at, n.hidden_by_name, n.hide_reason, n.updated_at, s.position
        from note_sections s
        join notes n on n.id = s.note_id
        cross join ${query}
        where s.search @@ q.query and n.deleted_at is null and ${open}
          and ${visible} and ${within})
        union all
        (select n.id, n.title, n.folder_id, null, null, n.version, q.query,
          ts_rank(to_tsvector('simple', n.title), q.query)::float8, '',
          n.hidden_at, n.hidden_by_name, n.hide_reason, n.updated_at, 0
        from notes n
        cross join ${query}
        where ${titleOnly} and to_tsvector('simple', n.title) @@ q.query
          and n.deleted_at is null and ${visible} and ${within})
        order by rank desc, updated_at desc, position
        limit ${input.limit}
      ) hit
      order by hit.rank desc
    `);
      const ranks = relativeRanks(rows.map((row) => Number(row.rank)));
      return rows.map((row, position) => ({
        noteId: row.note_id,
        title: row.title,
        folderId: grant.view.shownFolderId(row.folder_id),
        folderPath: index.pathOf(row.folder_id),
        sectionPath: row.path,
        heading: row.heading,
        snippet:
          row.path === null
            ? ""
            : finishSnippet(
                unmarkCompoundParts(row.snippet, input.query),
                row.text,
                SNIPPET_FRAGMENT_DELIMITER,
              ),
        hidden: noteHiddenState(grant.view, {
          id: row.note_id,
          title: row.title,
          folderId: row.folder_id,
          hiddenAt: row.hidden_at === null ? null : new Date(row.hidden_at),
          hiddenByName: row.hidden_by_name,
          hideReason: row.hide_reason,
        }),
        version: row.version,
        rank: ranks[position] ?? 0,
      }));
    },
    (hits) => ({ details: { hitCount: hits.length } }),
  );
}
