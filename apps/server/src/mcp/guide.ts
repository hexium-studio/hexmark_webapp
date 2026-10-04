import { INTRODUCTION_SECTION_PATH } from "@hexmark/shared";
import { sectionTokenBudget } from "../config/notes";
import { trashRetentionDays } from "../config/trash";
import type { AccessDescription } from "../services/access/describe";

// What every connecting agent is told: the server instructions sent with
// `initialize`, and the longer guide behind the resource hexmark://guide.
// Both include the permissions of the token in use.

export const GUIDE_URI = "hexmark://guide";

function permissionsLine(access: AccessDescription): string {
  const scope = access.folderScope
    ? `limited to these folders and their subfolders: ${access.folderScope
        .map((folder) => `"${folder.path}" (${folder.id})`)
        .join(", ")}`
    : "the whole wiki";
  return (
    `This token acts as "${access.actorName}" with the permissions ` +
    `${access.permissions.join(", ") || "(none)"} on ${scope}.`
  );
}

// The retention is this server's setting (TRASH_RETENTION_DAYS).
function trashLine(): string {
  return (
    "delete_note and delete_folder move things to the trash; they can be restored " +
    `(restore_note, restore_folder) for ${trashRetentionDays} days, then the server deletes ` +
    "them for good. Agents cannot delete anything for good."
  );
}

export function serverInstructions(access: AccessDescription): string {
  return [
    "Hexmark is a Markdown wiki: notes in folders, every change kept as a revision.",
    permissionsLine(access),
    "Start with get_overview, find notes with search_notes, read large notes with " +
      "read_outline + read_section instead of read_note.",
    "Every write needs expected_version (the version you last read) and should carry a " +
      "short reason. A version_conflict means someone changed the note: read it again, " +
      "merge, retry.",
    trashLine(),
    `Read ${GUIDE_URI} for the details.`,
  ].join("\n");
}

export function guideText(access: AccessDescription): string {
  return `# Hexmark guide for agents

${permissionsLine(access)}

## Notes and folders
- A note is Markdown with a title, inside a folder or at the root level. Titles are unique
  within a folder (ignoring case) and never contain "/".
- Folders nest without limit; names are unique among siblings and never contain "/".
- Notes and folders have stable ids (UUIDs). Renaming or moving never changes an id, so
  keep ids when you refer to notes later. Links to notes look like [Title](hexmark:<id>)
  (the final link syntax follows in a later version).

## Addressing a note
Wherever a tool takes \`note\`, it accepts the id, the title, or the folder path + title
("Projects/Web/Naming conventions"; "/Title" for the root level). A title that several
notes share returns ambiguous_note with candidates (id, path): repeat with the id or path.

## Sections
The server splits every note at its headings (# to ######, also underlined ones; not inside
code blocks). The text before the first heading is "${INTRODUCTION_SECTION_PATH}".
A section's path joins the headings above it with " > " ("Setup > Docker"); repeated
paths get " (2)", " (3)". Tools take the full path or its end ("Docker", "Setup > Docker"),
ignoring case; an end that fits several sections (a heading that occurs twice) returns
ambiguous_section with the full paths to choose from (and your path as section).
read_outline lists the paths with their size. A section includes its subsections unless
you pass include_subsections: false, and so do its sizes (characters, approxTokens).
Sizes are estimates (UTF-8 bytes / 4). Sections above ${sectionTokenBudget} estimated
tokens are marked overBudget: read their subsections one by one, or read the section in
pieces with read_section limit (e.g. 20000 characters) and then offset: nextOffset until
hasMore is false; pieces end at a line break (a limit shorter than a line cuts inside it;
an offset at or past the end returns an empty piece with a notice; past the end, offset is
the end and requestedOffset the one you asked for). Writes warn about sections whose own text is
above that budget; consider splitting them with more headings.

## Searching
search_notes finds sections that contain all the words (no stemming, case is ignored).
"quoted phrases" must occur as written, OR between words accepts either, -word excludes
a word. Each hit gives the sectionPath for read_section, the section's heading as written
(no marks) and a snippet of its text: matches marked «like this» (a phrase as one mark),
"…" only where text is left out. rank is relative to the best hit of the search (1).

## Writing
- create_note and create_folder create; update_note changes title and/or body;
  replace_section replaces one section from its heading line on (send the heading too);
  move_note moves a note to another folder (folder_id null: root level).
- rename_folder and move_folder (parent_id null: root level) change a folder by its id;
  everything inside goes along and keeps its id. Folders keep no history: no
  expected_version; their reason (create_folder takes one too) is kept in the audit log.
  A folder cannot move into its own subtree (folder_cycle, naming both folders).
- Every change of an existing note needs expected_version: the version you read last.
  If the note changed meanwhile you get version_conflict with currentVersion, the time,
  who changed it and, for replace_section, the section's current text. Read again, merge
  your change, retry. Nothing is merged automatically.
- Give a short reason with every write; it is shown in the history next to this token's name.
- A write that changes nothing returns changed: false and keeps the version; no revision
  is written, its reason is dropped, and a message says so.
- replace_section adds a blank line at the end of your text when a heading follows and
  the text does not end with one; nothing else of the text is changed.
- Locking comes in a later version: the lock permission has no tool yet.

## Trash
${trashLine()}
- delete_note (with expected_version) and delete_folder take a reason. A folder goes to
  the trash with all its subfolders and notes as one batch; restore_folder brings the
  whole batch back. Every note deleted or restored gets a new version ("deleted",
  "restored") with your reason.
- list_trash shows what is in the trash with ids, original paths, where it was
  (parentId, parentPath), who deleted it and purgeAt. Items in the trash are named by id
  only: a note in the trash named by its id answers in_trash, a folder folder_in_trash
  (also when you list it, search it or write into it), each with its path and, when it
  went with a folder above it, that folder (batchRootId, batchRootPath) for restore_folder.
- restore_note puts a note back where it was, or into folder_id, and under title when
  given. If its folder is in the trash as well you get parent_in_trash: restore that
  folder or pass folder_id. restore_folder answers how many subfolders (not counting the
  folder itself) and notes came back. A title taken meanwhile gives title_taken (pass another title
  or folder_id); a folder's name taken meanwhile gives name_taken (existingFolderId, path).

## History
list_changes(since) lists notes changed after a time; list_revisions and read_revision show
every earlier version of a note with time, author name, kind of change, reason and, for
replace_section, the section it changed. Besides that, the server's audit log records every
tool call of this token, reads included, and every refused call with its error code; people
can read it, agents cannot.

## Errors
Tool errors carry a code (e.g. not_found, forbidden, version_conflict, title_taken,
ambiguous_note, section_not_found) and a short message. forbidden names the missing
permission, or reason "outside_scope" for a folder this token cannot reach.
invalid_input means an argument breaks its rule: fields.<name>.rule says which
("title must not be empty"). title_taken names the note that has the title
(existingNoteId), name_taken the folder that has the name (existingFolderId);
version_conflict says what the newer version changed (lastChange).
`;
}
