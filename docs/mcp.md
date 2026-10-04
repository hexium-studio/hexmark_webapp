# MCP reference

Hexmark has a built-in [MCP](https://modelcontextprotocol.io) server. Agents
such as Claude Code read, search and write the wiki through it, with the same
permissions and checks as the web app. This page is the complete reference
for people setting up an agent and for agents using it:

1. [Overview](#overview): endpoint, transport, authentication, what the
   server tells an agent on its own.
2. [Setup](#setup): create a token, connect a client.
3. [Concepts](#concepts): notes, folders, ids, addressing, sections,
   versions, history, the trash, permissions.
4. [Recommended workflows](#recommended-workflows) for agents.
5. [Tool reference](#tool-reference): every tool with parameters, result,
   errors and an example (generated from the tool definitions).
6. [Errors](#errors): every error code and what to do about it.
7. [HTTP API and limits](#http-api-and-limits).

## Overview

| | |
|---|---|
| Endpoint | `POST /mcp` on the API server (port `SERVER_PORT`, default 3001), e.g. `http://localhost:3001/mcp`; in production the address in `MCP_PUBLIC_URL` |
| Transport | Streamable HTTP, **stateless**: every request is answered on its own, there are no sessions and no server-initiated stream (`GET` and `DELETE /mcp` answer 405). Answers are plain JSON. |
| Authentication | An API token in every request: `Authorization: Bearer hmk_…` |
| Capabilities | 21 tools, 1 resource (`hexmark://guide`), server instructions |

When an agent connects, the server sends **instructions** with `initialize`:
what Hexmark is, which name and permissions the token has and on which
folders, how to start, and the rules for writing. The **resource**
`hexmark://guide` (Markdown) explains notes, folders, addressing, sections,
writing, history and errors in more detail, again with the token's own
permissions. Agents that do not read resources find the same rules in the
tool and parameter descriptions.

Each request is checked twice: at the door (a missing, unknown, revoked or
expired token gets HTTP 401 before any tool runs) and again inside every
tool call, on the locked token row.

## Setup

### 1. Create an API token

On the token page of your account (`/account/tokens`), create a token with a
name (e.g. `claude-code-laptop`), its [permissions](#permissions) and,
optionally, the folders it is limited to and an expiry date. The name is shown
in the history next to every change the agent makes. A token grants access to
the wiki, so creating one asks for your password unless you entered it in the
last 10 minutes (the server enforces this; revoking a token never asks).

The token is shown **once**, together with a ready client configuration in
the common `mcpServers` format:

```json
{
  "mcpServers": {
    "hexmark": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer hmk_…" }
    }
  }
}
```

Copy it right away; it cannot be shown again. A lost token is revoked on the
token page and replaced by a new one. Revoking takes effect with the
agent's next request.

The `url` is `MCP_PUBLIC_URL` when the server has it (see
[deployment](deployment.md#agents-and-mcp-mcp_public_url)); otherwise the host
the browser used with `SERVER_PORT`.

### 2. Connect a client

**Clients that read `mcpServers` JSON** (Claude Desktop, Cursor, VS Code, many
others): paste the block into the client's MCP configuration, or merge the
`hexmark` entry into an existing `mcpServers` object. This is the primary
way to connect.

**Claude Code** accepts the same block:

```sh
claude mcp add-json hexmark '{"type":"http","url":"http://localhost:3001/mcp","headers":{"Authorization":"Bearer hmk_…"}}'
```

or the address and header on their own:

```sh
claude mcp add --transport http hexmark http://localhost:3001/mcp \
  --header "Authorization: Bearer hmk_…"
```

Clients that support only local (stdio) servers need a bridge to Streamable
HTTP; Hexmark does not ship one.

After connecting, a good first call is [`get_overview`](#get_overview).

### 3. After a server update: reconnect

MCP clients fetch the tool list once per session and keep it. When the
server was updated while an agent was connected (new tools, new
parameters), the agent still sees the old list and may send arguments the
old schema described, e.g. a number as a string, which the server then
refuses with `invalid_input`. Reconnect after an update: in Claude Code
`/mcp` → `hexmark` → reconnect, or start a new session; other clients
have a similar reconnect or restart.

## Concepts

### Notes and folders

- A **note** is Markdown with a title, inside a folder or at the root level.
  Titles are unique within a folder, ignoring case, and never contain `/` or
  line breaks (max 200 characters). A body may be up to 1 MiB.
- **Folders** nest without limit. Names are unique among siblings, ignoring
  case, with the same character rules (max 120 characters). Folders have no
  versions and keep no history: creating, renaming (`rename_folder`) or
  moving (`move_folder`) one takes no `expected_version`. Creating,
  renaming and moving take a `reason`, which is kept in the
  [audit log](audit.md) (there is no folder history to show it in).
  Renaming or moving a folder takes everything inside along; all ids stay.
- **Paths** join folder names from the root with `/`: the folder path
  `Projects/Web`, the note path `Projects/Web/Naming conventions`. The root
  level's folder path is the empty string.

### Stable ids

Every note and folder has an id (a UUID) that never changes: renaming or
moving keeps it. Agents should remember ids, not titles or paths, when they
refer to a note later.

### Addressing a note

Every tool parameter called `note` accepts:

| Form | Example | Matches |
|---|---|---|
| id | `5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53` | that note (falls back to a title of that text) |
| title | `Naming conventions` | a note with that title in any folder, ignoring case |
| folder path + title | `Projects/Web/Naming conventions` | that title in that folder |
| `/` + title | `/Welcome` | that title at the root level |

A title that several visible notes share fails with
[`ambiguous_note`](#errors); `candidates` lists up to 20 of them with id and
path. Repeat the call with an id or a path. Notes outside the token's folders are not
found, as if they did not exist.

### Sections

Hexmark splits every note into sections automatically on every write; nobody
marks them up.

- The split follows the Markdown headings (`#` to `######`, also underlined
  Setext headings). Headings inside code blocks, HTML blocks, lists or block
  quotes do not count.
- A section starts at its heading line and ends where the next heading
  starts. Its **subsections** are the headings of a deeper level below it,
  up to the next heading of the same or a higher level.
- A section's **path** joins the headings above it with ` > `:
  `Setup > Docker`. A path that already exists in the note (ignoring case)
  gets ` (2)`, ` (3)`, …: the second `Examples` heading under `Setup` is
  `Setup > Examples (2)`. An empty heading is `(untitled)`.
- Text before the first heading is the section `(introduction)` (level 0),
  listed only when it is not blank or the note has no heading at all.
- Tools take a section by its path, case ignored, in this order: the exact
  path; the path ignoring case; the **end of a path** in whole headings
  (`Teams > Apps` for `Naming > Teams > Apps`, or the last heading alone)
  when it names exactly one section. An end that fits several sections
  fails with `ambiguous_section` and lists their full paths (and repeats
  the path you gave as `section`, as `section_not_found` does); so does a
  heading that occurs twice, even though the second one's path ends in
  ` (2)`. (A full path always wins: `Setup > Examples` is the first
  `Examples` under `Setup`.) Nothing found gives `section_not_found` with
  the note's paths. Paths come from `read_outline` and `search_notes`.
- [`read_section`](#read_section) and [`replace_section`](#replace_section)
  **include the subsections by default** (`include_subsections: true`).
  With `false` they cover only the section's own text up to its first
  subsection.
- Sizes **include the subsections** (as the text does by default) and are
  given in characters and in `approxTokens`, an **estimate**
  (UTF-8 bytes / 4). Real token counts depend on the model's tokenizer and
  on the language: for English text the estimate is close, for text with
  many non-Latin characters it is rougher.
- Sections above the **reading budget** (`SECTION_TOKEN_BUDGET`, default
  8000 estimated tokens, set per server) are marked `overBudget` in the
  outline: read their subsections one by one, or read the section **in
  pieces** (below). A write whose result has a section whose own text is
  above the budget returns a `section_over_budget` warning with a short
  `message`. The budget is advice, **not a limit**: nothing is refused
  because of it.
- **Reading in pieces:** `read_section` takes `offset` and `limit` in
  characters (Unicode code points, the unit of all section sizes). The
  answer says where the piece starts (`offset`), how long it is
  (`returned`), how long the section is (`total`), and `hasMore` /
  `nextOffset`. A piece that does not reach the end is cut after its last
  line break, so lines stay whole; only a single line longer than `limit`
  is cut inside (a `limit` shorter than the line cuts it there; the next
  piece goes on inside the line). Call again with `offset: nextOffset`
  until `hasMore` is false. An offset at or past the end gives an empty
  piece with a `notice` saying so (`offset is past the end (total N); …`);
  past the end, `offset` is the section's end and `requestedOffset` the
  offset you asked for.
- **Replacing a section** keeps the text as sent, with one exception: when
  another heading follows and the text does not end with a blank line, a
  blank line is added so the next heading stays separate. Sending the
  section's current text unchanged changes nothing.

### Searching

`search_notes` finds sections containing all the words of the query, in any
order; case is ignored and words are not reduced to a stem (`plan` does not
find `plans`). `"quoted phrases"` must occur as written, `OR` between two
words accepts either, `-word` excludes sections with that word. Hits are
ranked per section; each names the `sectionPath` to read and the section's
`heading` as written (no marks, so it compares with the outline). The `snippet` comes from the section's text
without its heading line: matches are marked `«like this»` (the words of a
phrase, and neighbouring matches, as one mark; a hyphenated word such as
`app-kasse` is marked as one when the query has it, and its parts elsewhere
in the snippet - `App` alone, `app` in `app-kalender` - are not marked,
unless the query also has that part as a word of its own: `app app-kasse`
marks every `app`), punctuation at the
start and end of the shown words is kept, a short rest without words at
either end (an emoji with its period, a code fence) is shown rather than
dropped, and `…` shows only where text before, between or after them was
really left out. `rank` is relative to the best hit of
the same search: `1` for the best, between 0 and 1 for the others (three
decimals); a raw full-text rank says little on its own.

### Versions and `expected_version`

Every note has a version, starting at 1 and raised by every change. Every
read returns it, and every change of an existing note (`update_note`,
`replace_section`, `move_note`) must send the version it is based on as
`expected_version`. If the note has a newer version, nothing is written: the
tool fails with `version_conflict` (optimistic concurrency, no locks held
between calls).

A write that would change nothing returns `changed: false` and keeps the
version; no revision is written, so its `reason` is not kept either. The
answer then carries a `message` saying so ("Nothing differs from the
current version; no revision was created and the reason was dropped.").

Every note write answers with the note's `id`, `version`, `changed`,
`updatedAt`, its `folderPath` and `path` after the write, and `warnings`.

### Handling a version conflict

The `version_conflict` error carries `currentVersion`, `updatedAt`,
`updatedBy` (who wrote the newer version) and `lastChange`: what that version
changed (`change`, `reason`, and `sectionPath` when it was a
`replace_section`), so an agent can judge whether its own change is
affected. `replace_section` also sends `currentSection` (`path` and `text` of
the section now, or `null` when it no longer exists). Then:

1. Read the note (or the section) again.
2. Merge your change into the current text; never just overwrite what the
   other writer did. Nothing is merged automatically.
3. Retry with the new version as `expected_version`.

### Reasons, revisions and actor names

- Every write takes a short `reason` (max 500 characters). It is optional,
  but agents should always give one: it is shown in the history next to the
  author.
- Every version is kept as a full **revision** (title, body, folder,
  metadata), with the time, the kind of change (`created`, `edited`,
  `renamed`, `moved`, `deleted`, `restored`), the reason and the author.
  A `replace_section` also records the section's full path (`sectionPath`;
  a path above 1000 characters keeps its end, after `… > `). Revisions
  written before this was recorded have `sectionPath: null`.
- The author is recorded by **name**: a human's username, or for an agent
  the **API token's name** (e.g. `claude-code-laptop`), not the owner's
  username. The name is stored with each revision, so the history keeps the
  name as it was at the time.
- Besides the history, the server keeps an **audit log** that people (not
  agents) can read: every tool call of an agent is in it - reads too, with
  what was read - and so is every refused call, with its error code and the
  arguments summarized (never a note body). Folder reasons are kept there.
  See [audit.md](audit.md).

### Permissions

A token has a set of permissions, chosen when it is created:

| Permission | Allows (MCP tools) |
|---|---|
| `read` | `get_overview`, `list_folder`, `read_outline`, `read_section`, `read_note`, `list_changes`, `list_revisions`, `read_revision` |
| `search` | `search_notes` |
| `create` | `create_note`, `create_folder` |
| `edit` | `update_note`, `replace_section`, `rename_folder` |
| `move` | `move_note`, `move_folder` |
| `delete` | `delete_note`, `delete_folder`, `list_trash`, `restore_note`, `restore_folder`: into the trash and back, never for good |
| `lock` | reserved: locking comes in a later version |

The token page does not offer `lock` yet, as no MCP tool uses it; the
server still accepts it (e.g. tokens created over the HTTP API).

A token never exceeds its owner: a guest's token can read and search only,
whatever was chosen. A tool called without its permission fails with
`forbidden` and `permission` naming what is missing.

### Folder scope

A token can be limited to folders. It then sees those folders and all their
subfolders, and nothing else: no notes at the root level, no other folders.
Listings and search leave the rest out (`list_folder` without `folder_id`
lists the token's top folders), and addressing a note outside the scope
gives `not_found`. Writing into a folder outside the scope (or at the
root level) fails with `forbidden` and `reason: "outside_scope"`, so the
agent learns why. `get_overview` names the folders (`access.folderScope`).

### The trash

Deleting never removes anything at once: `delete_note` and `delete_folder`
move it to the **trash**.

- A note in the trash disappears from reads, search, listings and
  addressing by title or path; its title is free again in its folder.
  Named by its id it answers [`in_trash`](#errors) with `deletedAt`,
  `purgeAt`, `batchId` and `path` (where it was), and, when it went to the
  trash with a folder, that folder as `batchRootId` and `batchRootPath`.
  `list_changes` lists it with `deleted: true`.
- A folder in the trash, named by its id where a folder in use is expected
  (`list_folder`, `search_notes`, a target `folder_id` / `parent_id`,
  `rename_folder`, `move_folder`, `delete_folder`), answers
  [`folder_in_trash`](#errors) with `folderId`, `path` (where it was),
  `deletedAt`, `purgeAt` and `batchId`; when it went with a folder above
  it, that folder as `batchRootId` and `batchRootPath` - the id
  `restore_folder` takes to bring the batch back.
  Both answers come only for items inside the token's folders; outside
  them the answer stays `not_found` / `folder_not_found`.
- A folder goes to the trash with all its subfolders and notes as **one
  batch** (they share a `batchId`). `restore_folder` brings back exactly
  that batch; items deleted on their own before stay in the trash.
- Every note deleted or restored, also along with a folder, gets a new
  version: a revision with change `deleted` or `restored`, the actor's
  name and the reason.
- Items stay in the trash for the server's **retention**
  (`TRASH_RETENTION_DAYS`, default 28 days; the server instructions and
  the guide name the configured value). An item deleted at time T is
  purged once T + retention has passed, so with 28 days on day 29: the
  server checks at start and then every hour and deletes such notes (with
  their revisions and sections) and folders for good.
- `list_trash` lists the trash, newest first, with ids, original paths,
  where each item was (`parentId`, `parentPath`: a note's folder, a
  folder's parent; `id` is always the item itself), who deleted what,
  `purgeAt` and, for a folder deleted with its
  contents, how many subfolders and notes went with it. A token limited to
  folders sees only items that lay inside them.
- `restore_note` puts a note back where it was, or into `folder_id`, and
  under `title` when given. If its folder is in the trash as well it fails
  with `parent_in_trash` (naming that folder): restore the folder, or pass
  `folder_id`. A title taken meanwhile gives `title_taken`: restore with
  another `title` or into another `folder_id`. For a folder, a name taken
  meanwhile gives `name_taken` (naming the folder that holds it).
  `restore_folder` answers with the batch and how many subfolders (not
  counting the folder itself, like `folderCount` of `delete_folder`) and
  notes came back with it (`restoredSubfolders`, `restoredNotes`).
- **Agents never delete anything for good**: there is no such tool, and
  the HTTP endpoints for it refuse API tokens (403). Only signed-in people
  can delete from the trash for good (and administrators empty it), with
  their password re-entered in the last 10 minutes, and the purge removes
  what is due.

### Revoked and expired tokens

Revoking a token on the token page takes effect with the agent's very next
request: the server is stateless and checks the token on every request (HTTP
401 `token_revoked`). An expired token is refused the same way
(`token_expired`). In both cases the agent should stop and ask its user for a
new token; retrying does not help.

### Server not set up yet

While the server's `SETUP_TOKEN` is still set (first-run setup not
finished), nobody can sign in and **no API token works**: requests are
refused with HTTP 403 `setup_token_present`. The administrator finishes the
setup and removes `SETUP_TOKEN`; see [deployment](deployment.md).

## Recommended workflows

**Orient.** Call `get_overview` first: it tells the agent its name in the
history, its permissions, its folders and the top of the tree. Go deeper with
`list_folder` (`folder_id`, `depth`). A folder where the listing's depth ends
has `loaded: false` with `folderCount` and `noteCount` instead of its
contents: not empty, just not listed.

**Find and read.** `search_notes` → pick a hit → `read_outline` of that note
if it is large → `read_section` with the hit's `sectionPath` or a path from
the outline. Use `read_note` only for small notes; it adds a `hint` when a
note is above the reading budget. Read an `overBudget` section without
subsections in pieces (`limit`, then `offset: nextOffset`).

**Edit safely.**

1. Read what you change (`read_section` or `read_note`) and keep the
   version.
2. Change one section with `replace_section` (send the heading line too) or
   the title or whole body with `update_note`, always with
   `expected_version` and a short `reason`.
3. On `version_conflict`: read again, merge, retry with the new version.
4. Use the returned `version` as `expected_version` of your next write to the
   same note. Consider splitting sections named in `warnings`.

**Create.** Check with `search_notes` or `list_folder` that the note does not
exist yet, then `create_note` (folder id, title, Markdown body, reason). Keep
the returned id. Create missing folders with `create_folder` first.

**Move.** `move_note` with the note, its current version, the target
`folder_id` (`null` for the root level) and a reason. The id stays the same;
a note with the same title in the target folder gives `title_taken`.
Folders move with `move_folder` (`parent_id`, `null` for the root level) and
are renamed with `rename_folder`; everything inside goes along.

**Delete and restore.** `delete_note` with the note's current version and
a reason, or `delete_folder` for a folder with everything in it. Keep the
returned id: `restore_note` / `restore_folder` take it. `list_trash` shows
what is there and until when. Nothing an agent deletes is gone before the
retention ends.

**Audit history.** `list_changes` with `since` (e.g. the time of your last
visit) lists what changed; `list_revisions` shows a note's versions with
author and reason; `read_revision` shows one version in full, e.g. to compare
it with the current text or to bring old text back with `update_note`.

## Tool reference

<!-- BEGIN GENERATED: mcp-tools -->

<!-- Generated by tools/generate-mcp-docs.mjs from packages/shared/src/mcp. Do not edit by hand: change the definitions, then run `pnpm docs:mcp`. -->

| Tool | Permission | Kind | Purpose |
| --- | --- | --- | --- |
| [`get_overview`](#get_overview) | `read` | read-only | Start here. Returns who this token acts as (the name shown in the history), its permissions and the folders it is limited to, the top two levels of the folder tree with note ids, titles and versions, and how many notes and folders it can see. |
| [`list_folder`](#list_folder) | `read` | read-only | List a folder's subfolders and notes (id, title, version, last change), or the root level when folder_id is left out. |
| [`search_notes`](#search_notes) | `search` | read-only | Full-text search over all notes this token can see, ranked per section. |
| [`read_outline`](#read_outline) | `read` | read-only | Get a note's table of contents without its text: every section's path, heading level, size in characters and estimated tokens (both including its subsections), and overBudget for sections above the reading budget: read their subsections one by one, or the section in chunks with read_section offset/limit. |
| [`read_section`](#read_section) | `read` | read-only | Read one section's Markdown from its heading line on, including its subsections unless include_subsections is false. |
| [`read_note`](#read_note) | `read` | read-only | Read a whole note: Markdown body, metadata, size (characters and estimated tokens) and its version (pass it as expected_version to update_note). |
| [`list_changes`](#list_changes) | `read` | read-only | List the notes changed after a time, newest first, one entry per note: its latest change (created, edited, renamed, moved, deleted, restored), how many changes there were, who made the latest one and why, and the section it edited. |
| [`list_revisions`](#list_revisions) | `read` | read-only | List every version of a note, newest first: version number, time, author name (username or token name), kind of change, reason, the section an edit changed, and the title and folder at that version. |
| [`read_revision`](#read_revision) | `read` | read-only | Read the full snapshot of one version of a note: title, Markdown body, metadata, folder, author name, kind of change and reason. |
| [`create_note`](#create_note) | `create` | writes | Create a note in a folder, or at the root level when folder_id is left out, with a short reason. |
| [`update_note`](#update_note) | `edit` | writes | Replace a note's title and/or its whole body. |
| [`replace_section`](#replace_section) | `edit` | writes | Replace one section of a note, from its heading line on (with its subsections unless include_subsections is false), by the given Markdown, which should start with the heading line. |
| [`move_note`](#move_note) | `move` | writes | Move a note into another folder (folder_id null: the root level); its id stays the same. |
| [`create_folder`](#create_folder) | `create` | writes | Create a folder inside a parent folder, or at the root level when parent_id is left out. |
| [`rename_folder`](#rename_folder) | `edit` | writes | Give a folder a new name; its id, its contents and the notes' ids stay the same, the paths below it change. |
| [`move_folder`](#move_folder) | `move` | writes | Move a folder with everything in it into another parent folder (parent_id null: the root level). |
| [`delete_note`](#delete_note) | `delete` | moves to the trash | Move a note to the trash: it disappears from reads, search and listings, its title is free again, and the deletion is a new version with your reason. |
| [`delete_folder`](#delete_folder) | `delete` | moves to the trash | Move a folder with all its subfolders and notes to the trash, as one batch: restoring the folder brings all of it back. |
| [`list_trash`](#list_trash) | `delete` | read-only | List what is in the trash, newest first: notes and folders deleted on their own, and for a folder deleted with its contents the folder alone, with how many subfolders and notes went with it. |
| [`restore_note`](#restore_note) | `delete` | writes | Bring a note back from the trash, by its id: into the folder it was deleted from, or into folder_id when given, under its old title or title when given. |
| [`restore_folder`](#restore_folder) | `delete` | writes | Bring a folder back from the trash, by its id, together with everything that was deleted with it (its batch); items deleted on their own before stay in the trash. |

Results are JSON objects, sent as the text content of the tool result. Failures set `isError` and send `{ error, message, ...details }` (see [Errors](#errors)). Every tool can also fail with the common errors `invalid_input`, `forbidden`, `token_revoked`, `token_expired`, `setup_token_present`, `database_unavailable`, `server_not_configured`.

### `get_overview`

**Overview** · permission `read` · read-only

Start here. Returns who this token acts as (the name shown in the history), its permissions and the folders it is limited to, the top two levels of the folder tree with note ids, titles and versions, and how many notes and folders it can see. Go deeper with list_folder. Requires the read permission.

**Parameters**

None.

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `instance.name` | string | Name of the wiki software. |
| `access.kind` | "token" | Always token over MCP. |
| `access.actorName` | string | The token's name: shown in the history for its changes. |
| `access.permissions` | string[] | What this token may do (see Permissions). |
| `access.folderScope` | array \| null | Folders (id, path) the token is limited to, with their subfolders; null: whole wiki. |
| `tree.folder` | object \| null | The folder listed (id, name, path); null for the root level. |
| `tree.folders[]` | array | Subfolders, sorted by name. |
| `tree.folders[].id` | string (uuid) | The folder's id. |
| `tree.folders[].name` | string | The folder's name. |
| `tree.folders[].path` | string | Folder names from the root joined by '/'. |
| `tree.folders[].folderCount` | integer | Subfolders directly inside it. |
| `tree.folders[].noteCount` | integer | Notes directly inside it. |
| `tree.folders[].loaded` | boolean | false where the requested depth ends: then folders and notes are left out (not empty); list the folder itself to open it. |
| `tree.folders[].folders` | array (loaded only) | Its subfolders, same shape. |
| `tree.folders[].notes` | array (loaded only) | Its notes, same shape as notes[]. |
| `tree.notes[]` | array | Notes directly in the folder, sorted by title. |
| `tree.notes[].id` | string (uuid) | The note's id. |
| `tree.notes[].title` | string | The note's title. |
| `tree.notes[].version` | integer | The note's current version. |
| `tree.notes[].updatedAt` | string (ISO 8601) | When the latest version was written. |
| `tree.notes[].updatedBy` | string | Who wrote it: a username or a token name. |
| `tree.notes[].lastChange` | string | What the latest version changed: created, edited, renamed, moved or restored. |
| `treeDepth` | integer | Folder levels the tree shows (2). |
| `counts.notes` | integer | Notes this token can see. |
| `counts.folders` | integer | Folders this token can see. |

**Errors**

- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{}
```

and result

```json
{
  "instance": {
    "name": "Hexmark"
  },
  "access": {
    "kind": "token",
    "actorName": "docs-agent",
    "permissions": [
      "read",
      "search",
      "create",
      "edit"
    ],
    "folderScope": null
  },
  "tree": {
    "folder": null,
    "folders": [
      {
        "id": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
        "name": "Projects",
        "path": "Projects",
        "folderCount": 1,
        "noteCount": 1,
        "loaded": true,
        "folders": [
          {
            "id": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
            "name": "Web",
            "path": "Projects/Web",
            "folderCount": 0,
            "noteCount": 1,
            "loaded": false
          }
        ],
        "notes": [
          {
            "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
            "title": "Release checklist",
            "version": 2,
            "updatedAt": "2026-09-30T16:05:11.000Z",
            "updatedBy": "alex",
            "lastChange": "edited"
          }
        ]
      }
    ],
    "notes": [
      {
        "id": "91c3f6d8-5e2a-4b07-a8d9-3e6f1b5c7d20",
        "title": "Welcome",
        "version": 1,
        "updatedAt": "2026-09-01T10:00:00.000Z",
        "updatedBy": "alex",
        "lastChange": "created"
      }
    ]
  },
  "treeDepth": 2,
  "counts": {
    "notes": 3,
    "folders": 2
  }
}
```

### `list_folder`

**List folder** · permission `read` · read-only

List a folder's subfolders and notes (id, title, version, last change), or the root level when folder_id is left out. Raise depth to open subfolders as well; a subfolder where the depth ends has loaded: false and only its folderCount and noteCount. Lists titles only; read a note with read_outline, read_section or read_note. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | no |  | Folder id from get_overview or list_folder; leave out for the root level. |
| `depth` | integer 1-10 | no | `1` | Levels to list: 1 lists the folder's own subfolders and notes, each further level opens the subfolders one step deeper (default 1). |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `folder` | object \| null | The folder listed (id, name, path); null for the root level. |
| `folders[]` | array | Subfolders, sorted by name. |
| `folders[].id` | string (uuid) | The folder's id. |
| `folders[].name` | string | The folder's name. |
| `folders[].path` | string | Folder names from the root joined by '/'. |
| `folders[].folderCount` | integer | Subfolders directly inside it. |
| `folders[].noteCount` | integer | Notes directly inside it. |
| `folders[].loaded` | boolean | false where the requested depth ends: then folders and notes are left out (not empty); list the folder itself to open it. |
| `folders[].folders` | array (loaded only) | Its subfolders, same shape. |
| `folders[].notes` | array (loaded only) | Its notes, same shape as notes[]. |
| `notes[]` | array | Notes directly in the folder, sorted by title. |
| `notes[].id` | string (uuid) | The note's id. |
| `notes[].title` | string | The note's title. |
| `notes[].version` | integer | The note's current version. |
| `notes[].updatedAt` | string (ISO 8601) | When the latest version was written. |
| `notes[].updatedBy` | string | Who wrote it: a username or a token name. |
| `notes[].lastChange` | string | What the latest version changed: created, edited, renamed, moved or restored. |

**Errors**

- `folder_not_found`: No such folder, or it lies outside this token's folders.
- `folder_in_trash`: That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, batchId; batchRootId and batchRootPath when it went with a folder above it, which restore_folder takes); restore it with restore_folder first.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31"
}
```

and result

```json
{
  "folder": {
    "id": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
    "name": "Projects",
    "path": "Projects"
  },
  "folders": [
    {
      "id": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
      "name": "Web",
      "path": "Projects/Web",
      "folderCount": 0,
      "noteCount": 1,
      "loaded": false
    }
  ],
  "notes": [
    {
      "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
      "title": "Release checklist",
      "version": 2,
      "updatedAt": "2026-09-30T16:05:11.000Z",
      "updatedBy": "alex",
      "lastChange": "edited"
    }
  ]
}
```

### `search_notes`

**Search notes** · permission `search` · read-only

Full-text search over all notes this token can see, ranked per section. Each hit names the note (noteId, title, folder path), the sectionPath to pass to read_section, its heading as written, a snippet of its text with matches marked «like this» (… where it is cut off), the note's current version and a relative rank. Search first, then read only the sections you need. Requires the search permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string, 1-500 chars | yes |  | Words to find; all must occur in the same section (no stemming, case is ignored). Supports "quoted phrases", OR between words and -word to exclude a word. |
| `folder_id` | string (uuid) | no |  | Search only this folder and its subfolders; leave out to search everything. |
| `limit` | integer 1-50 | no | `20` | Maximum hits (default 20). |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `hits[]` | array | Best matches first; one hit per matching section. |
| `hits[].noteId` | string (uuid) | The note's id. |
| `hits[].title` | string | The note's title. |
| `hits[].folderId` | string \| null | The note's folder; null for the root level. |
| `hits[].folderPath` | string | Folder names from the root joined by '/'. |
| `hits[].sectionPath` | string | The matching section: pass it to read_section. |
| `hits[].heading` | string | The section's heading as written, without marks; '' for the introduction. |
| `hits[].snippet` | string | The section's text around the matches, without its heading line; matches marked «like this» (a phrase as one mark), '…' where text is left out. |
| `hits[].version` | integer | The note's current version. |
| `hits[].rank` | number | Relevance relative to the best hit of this search: 1 for the best, 0 to 1 for the others (three decimals). |

**Errors**

- `folder_not_found`: folder_id names no folder this token can see.
- `folder_in_trash`: That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, batchId; batchRootId and batchRootPath when it went with a folder above it, which restore_folder takes); restore it with restore_folder first.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "query": "kebab case",
  "limit": 5
}
```

and result

```json
{
  "hits": [
    {
      "noteId": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
      "title": "Naming conventions",
      "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
      "folderPath": "Projects/Web",
      "sectionPath": "Naming conventions > Branches",
      "heading": "Branches",
      "snippet": "Use `feature/<topic>` and `fix/<topic>` in «kebab»-«case».",
      "version": 4,
      "rank": 1
    }
  ]
}
```

### `read_outline`

**Read outline** · permission `read` · read-only

Get a note's table of contents without its text: every section's path, heading level, size in characters and estimated tokens (both including its subsections), and overBudget for sections above the reading budget: read their subsections one by one, or the section in chunks with read_section offset/limit. Also returns the note's version. Use it before read_section for anything but small notes. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `note.id` | string (uuid) | The note's id; never changes, even on rename or move. |
| `note.title` | string | The note's title. |
| `note.folderId` | string \| null | Folder the note is in; null for the root level. |
| `note.folderPath` | string | Folder names from the root joined by '/'; '' at the root. |
| `note.path` | string | folderPath + '/' + title (the title alone at the root): usable as its address. |
| `note.version` | integer | Current version: pass it as expected_version when writing. |
| `note.createdAt` | string (ISO 8601) | When the note was created. |
| `note.createdBy` | string | Who created it: a username or an API token's name. |
| `note.updatedAt` | string (ISO 8601) | When the latest version was written. |
| `note.updatedBy` | string | Who wrote the latest version: a username or a token name. |
| `budget` | integer | The reading budget per section in estimated tokens. |
| `sections[]` | array | The note's sections in reading order. |
| `sections[].position` | integer | 0, 1, 2, … in reading order. |
| `sections[].level` | integer | Heading level 1-6; 0 for the introduction. |
| `sections[].heading` | string | The heading's text. |
| `sections[].path` | string | Headings from the top joined by ' > ': the section's address. |
| `sections[].parentPosition` | integer \| null | Position of the enclosing section. |
| `sections[].characters` | integer | Size including subsections, in characters. |
| `sections[].approxTokens` | integer | Estimated tokens including subsections. |
| `sections[].overBudget` | boolean | approxTokens is above budget: read subsections, or in chunks (offset/limit). |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "Projects/Web/Naming conventions"
}
```

and result

```json
{
  "note": {
    "id": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
    "title": "Naming conventions",
    "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
    "folderPath": "Projects/Web",
    "path": "Projects/Web/Naming conventions",
    "version": 4,
    "createdAt": "2026-09-14T08:12:40.000Z",
    "createdBy": "alex",
    "updatedAt": "2026-10-01T09:30:00.000Z",
    "updatedBy": "docs-agent"
  },
  "budget": 8000,
  "sections": [
    {
      "position": 0,
      "level": 1,
      "heading": "Naming conventions",
      "path": "Naming conventions",
      "parentPosition": null,
      "characters": 2140,
      "approxTokens": 535,
      "overBudget": false
    },
    {
      "position": 1,
      "level": 2,
      "heading": "Files",
      "path": "Naming conventions > Files",
      "parentPosition": 0,
      "characters": 820,
      "approxTokens": 205,
      "overBudget": false
    },
    {
      "position": 2,
      "level": 2,
      "heading": "Branches",
      "path": "Naming conventions > Branches",
      "parentPosition": 0,
      "characters": 1190,
      "approxTokens": 298,
      "overBudget": false
    }
  ]
}
```

### `read_section`

**Read section** · permission `read` · read-only

Read one section's Markdown from its heading line on, including its subsections unless include_subsections is false. Take section paths from read_outline or search_notes. For a section above the reading budget pass limit (and then offset: nextOffset) to read it in pieces cut at line ends. Also returns the note's version: pass it as expected_version to replace_section. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `section` | string, 1-2000 chars | yes |  | Section path as read_outline or search_notes give it ('Setup > Docker'), or its end down to the last heading alone ('Docker') when that names one section only; a heading that occurs more than once fails with ambiguous_section and lists the candidates. Case is ignored. The text before the first heading is '(introduction)'. |
| `include_subsections` | boolean | no | `true` | Include the section's subsections (default true); false returns only the section's own text up to its first subsection. |
| `offset` | integer 0-1048576 | no |  | Read a long section in pieces: start at this character (Unicode code point) of the section's text (default 0). Pass nextOffset from the previous piece. An offset at or past the end returns an empty piece with a notice. |
| `limit` | integer 1-1048576 | no |  | At most this many characters (default: up to the end). A piece that does not reach the end is cut after its last line break, so lines stay whole; a limit shorter than the first line cuts inside that line. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `note.id` | string (uuid) | The note's id; never changes, even on rename or move. |
| `note.title` | string | The note's title. |
| `note.folderId` | string \| null | Folder the note is in; null for the root level. |
| `note.folderPath` | string | Folder names from the root joined by '/'; '' at the root. |
| `note.path` | string | folderPath + '/' + title (the title alone at the root): usable as its address. |
| `note.version` | integer | Current version: pass it as expected_version when writing. |
| `note.createdAt` | string (ISO 8601) | When the note was created. |
| `note.createdBy` | string | Who created it: a username or an API token's name. |
| `note.updatedAt` | string (ISO 8601) | When the latest version was written. |
| `note.updatedBy` | string | Who wrote the latest version: a username or a token name. |
| `section.path` | string | The section's full path (also when you gave the heading only). |
| `section.level` | integer | Heading level 1-6; 0 for the introduction. |
| `section.heading` | string | The heading's text. |
| `section.includesSubsections` | boolean | Whether text includes the subsections. |
| `section.text` | string | The Markdown, from the heading line on, as stored (or the piece). |
| `section.characters` | integer | Length of text in characters. |
| `section.approxTokens` | integer | Estimated tokens of text. |
| `section.offset` | integer | Where text starts in the section, in characters. |
| `section.returned` | integer | Characters in text (the same as characters). |
| `section.total` | integer | Characters in the whole section. |
| `section.hasMore` | boolean | true when text stops before the section's end. |
| `section.nextOffset` | integer \| null | offset of the next piece; null at the end. |
| `section.notice` | string (optional) | Only when offset is at or past the end: says so (the piece is empty). |
| `section.requestedOffset` | integer (optional) | Only when offset is past the end: the offset you asked for (offset is then total). |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- `section_not_found`: The note has no such section; paths lists the ones it has, section repeats yours.
- `ambiguous_section`: The path's end (e.g. a heading that occurs twice) names several sections; candidates lists their full paths, section repeats the one you gave.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "section": "Branches"
}
```

and result

```json
{
  "note": {
    "id": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
    "title": "Naming conventions",
    "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
    "folderPath": "Projects/Web",
    "path": "Projects/Web/Naming conventions",
    "version": 4,
    "createdAt": "2026-09-14T08:12:40.000Z",
    "createdBy": "alex",
    "updatedAt": "2026-10-01T09:30:00.000Z",
    "updatedBy": "docs-agent"
  },
  "section": {
    "path": "Naming conventions > Branches",
    "level": 2,
    "heading": "Branches",
    "includesSubsections": true,
    "text": "## Branches\n\nUse `feature/<topic>` and `fix/<topic>` in kebab-case.\n",
    "characters": 66,
    "approxTokens": 17,
    "offset": 0,
    "returned": 66,
    "total": 66,
    "hasMore": false,
    "nextOffset": null
  }
}
```

### `read_note`

**Read note** · permission `read` · read-only

Read a whole note: Markdown body, metadata, size (characters and estimated tokens) and its version (pass it as expected_version to update_note). For large notes use read_outline and read_section instead; a note above the reading budget comes with a hint. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `note.id` | string (uuid) | The note's id; never changes, even on rename or move. |
| `note.title` | string | The note's title. |
| `note.folderId` | string \| null | Folder the note is in; null for the root level. |
| `note.folderPath` | string | Folder names from the root joined by '/'; '' at the root. |
| `note.path` | string | folderPath + '/' + title (the title alone at the root): usable as its address. |
| `note.version` | integer | Current version: pass it as expected_version when writing. |
| `note.createdAt` | string (ISO 8601) | When the note was created. |
| `note.createdBy` | string | Who created it: a username or an API token's name. |
| `note.updatedAt` | string (ISO 8601) | When the latest version was written. |
| `note.updatedBy` | string | Who wrote the latest version: a username or a token name. |
| `note.body` | string | The whole Markdown body. |
| `note.metadata` | object | Front matter kept from an import; usually {}. |
| `note.characters` | integer | Length of the body in characters (code points). |
| `note.approxTokens` | integer | Estimated tokens of the body. |
| `hint` | string (optional) | Present when the note is above the reading budget. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53"
}
```

and result

```json
{
  "note": {
    "id": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
    "title": "Naming conventions",
    "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
    "folderPath": "Projects/Web",
    "path": "Projects/Web/Naming conventions",
    "version": 4,
    "createdAt": "2026-09-14T08:12:40.000Z",
    "createdBy": "alex",
    "updatedAt": "2026-10-01T09:30:00.000Z",
    "updatedBy": "docs-agent",
    "body": "# Naming conventions\n\nHow we name things.\n\n## Files\n\nkebab-case.\n",
    "metadata": {},
    "characters": 65,
    "approxTokens": 17
  }
}
```

### `list_changes`

**List changes** · permission `read` · read-only

List the notes changed after a time, newest first, one entry per note: its latest change (created, edited, renamed, moved, deleted, restored), how many changes there were, who made the latest one and why, and the section it edited. Use it to catch up since your last visit (folders have no versions and are not listed); see every version with list_revisions. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `since` | string (date-time) | yes |  | Only changes after this time: ISO 8601 with time zone, e.g. 2026-10-01T00:00:00Z. |
| `limit` | integer 1-500 | no | `100` | Maximum notes listed (default 100). |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `changes[]` | array | One entry per changed note, latest change first. |
| `changes[].noteId` | string (uuid) | The note's id. |
| `changes[].title` | string | The note's current title. |
| `changes[].folderPath` | string | The note's current folder path. |
| `changes[].version` | integer | The note's current version. |
| `changes[].change` | string | Latest change: created, edited, renamed, moved, deleted or restored. |
| `changes[].changes` | integer | How many versions were written since `since`. |
| `changes[].actorName` | string | Who made the latest change: username or token name. |
| `changes[].reason` | string \| null | The reason given with the latest change. |
| `changes[].sectionPath` | string \| null | The section the latest change edited (replace_section); null for whole-note changes. |
| `changes[].changedAt` | string (ISO 8601) | When the latest change was made. |
| `changes[].deleted` | boolean | true when the note is in the trash now. |

**Errors**

- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "since": "2026-10-01T00:00:00Z"
}
```

and result

```json
{
  "changes": [
    {
      "noteId": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
      "title": "Naming conventions",
      "folderPath": "Projects/Web",
      "version": 4,
      "change": "edited",
      "changes": 2,
      "actorName": "docs-agent",
      "reason": "Add branch naming rules",
      "sectionPath": "Naming conventions > Branches",
      "changedAt": "2026-10-01T09:30:00.000Z",
      "deleted": false
    }
  ]
}
```

### `list_revisions`

**List revisions** · permission `read` · read-only

List every version of a note, newest first: version number, time, author name (username or token name), kind of change, reason, the section an edit changed, and the title and folder at that version. Read one in full with read_revision. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `noteId` | string (uuid) | The note's id. |
| `path` | string | The note's current path. |
| `revisions[]` | array | Every version, newest first. |
| `revisions[].version` | integer | The version number. |
| `revisions[].change` | string | What it changed: created, edited, renamed, moved, deleted or restored. |
| `revisions[].reason` | string \| null | The reason given with the change. |
| `revisions[].actorName` | string | Who made it: username or token name, as it was then. |
| `revisions[].createdAt` | string (ISO 8601) | When it was written. |
| `revisions[].title` | string | The note's title at that version. |
| `revisions[].folderId` | string \| null | The note's folder at that version; null at the root or outside this token's folders. |
| `revisions[].folderPath` | string \| null | That folder's current path ('' at the root); null if it no longer exists or lies outside this token's folders. |
| `revisions[].folderOutsideScope` | boolean | True when that folder lies outside this token's folders; its id and path are not shown. |
| `revisions[].sectionPath` | string \| null | The section a replace_section changed, as its path was then; null for whole-note changes and for versions written before this was recorded. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53"
}
```

and result

```json
{
  "noteId": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "path": "Projects/Web/Naming conventions",
  "revisions": [
    {
      "version": 4,
      "change": "edited",
      "reason": "Add branch naming rules",
      "actorName": "docs-agent",
      "createdAt": "2026-10-01T09:30:00.000Z",
      "title": "Naming conventions",
      "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
      "folderPath": "Projects/Web",
      "folderOutsideScope": false,
      "sectionPath": "Naming conventions > Branches"
    },
    {
      "version": 3,
      "change": "moved",
      "reason": "Belongs to the web project",
      "actorName": "alex",
      "createdAt": "2026-09-20T14:02:09.000Z",
      "title": "Naming conventions",
      "folderId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
      "folderPath": "Projects/Web",
      "folderOutsideScope": false,
      "sectionPath": null
    }
  ]
}
```

### `read_revision`

**Read revision** · permission `read` · read-only

Read the full snapshot of one version of a note: title, Markdown body, metadata, folder, author name, kind of change and reason. Use it to see what an earlier version said, or to bring old text back with update_note. Requires the read permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `version` | integer ≥ 1 | yes |  | The version to read, from list_revisions. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `noteId` | string (uuid) | The note's id. |
| `version` | integer | The version number. |
| `change` | string | What it changed: created, edited, renamed, moved, deleted, restored. |
| `reason` | string \| null | The reason given with the change. |
| `actorName` | string | Who made it: username or token name, as it was then. |
| `createdAt` | string (ISO 8601) | When it was written. |
| `title` | string | The title at that version. |
| `folderId` | string \| null | The folder at that version; null at the root or outside. |
| `folderPath` | string \| null | That folder's current path; null if gone or outside. |
| `folderOutsideScope` | boolean | True when that folder lies outside this token's folders. |
| `sectionPath` | string \| null | The section a replace_section changed; else null. |
| `body` | string | The whole Markdown body at that version. |
| `metadata` | object | Front matter at that version. |

**Errors**

- `not_found`: No such note visible to this token, or the note has no such version.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "version": 1
}
```

and result

```json
{
  "noteId": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "version": 1,
  "change": "created",
  "reason": "First draft",
  "actorName": "alex",
  "createdAt": "2026-09-14T08:12:40.000Z",
  "title": "Naming",
  "folderId": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
  "folderPath": "Projects",
  "folderOutsideScope": false,
  "sectionPath": null,
  "body": "# Naming\n\nkebab-case everywhere.\n",
  "metadata": {}
}
```

### `create_note`

**Create note** · permission `create` · writes

Create a note in a folder, or at the root level when folder_id is left out, with a short reason. Returns the new note's id (keep it: ids never change), version 1 and path, plus warnings for sections above the reading budget. Requires the create permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | no |  | Folder to create the note in; leave out for the root level. |
| `title` | string, 1-200 chars | yes |  | Note title: unique within its folder (case is ignored), max 200 characters, no '/' or line breaks. |
| `body` | string | yes |  | The note's Markdown. Its headings (# to ######) split it into sections. Max 1 MiB. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The note's id. |
| `version` | integer | The note's version now: the expected_version of your next write. |
| `changed` | boolean | false when the write changed nothing; then no version was written and the reason was dropped. |
| `updatedAt` | string (ISO 8601) | When the version was written. |
| `folderPath` | string | The note's folder path now; '' at the root level. |
| `path` | string | The note's path now (folderPath + '/' + title): usable as its address. |
| `warnings[]` | array | section_over_budget for each section whose own text is above the reading budget (code, path, approxTokens, budget, message): split it with more headings or read it in chunks. Nothing is refused. |
| `message` | string (only if changed is false) | Says that nothing was written, and why. |

**Errors**

- `folder_not_found`: The target folder does not exist.
- `folder_in_trash`: That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, batchId; batchRootId and batchRootPath when it went with a folder above it, which restore_folder takes); restore it with restore_folder first.
- `forbidden`: The target (or the root level) is outside this token's folders (reason: outside_scope).
- `title_taken`: The folder already has a note with this title, case ignored (details: existingNoteId, path).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
  "title": "Deployment",
  "body": "# Deployment\n\n## Staging\n\nPush to `dev`; the pipeline deploys to staging.example.com.\n",
  "reason": "Document the staging deployment"
}
```

and result

```json
{
  "id": "6b0e3d71-4f9a-4c28-8b5e-0d2a7c9f1e46",
  "version": 1,
  "changed": true,
  "updatedAt": "2026-10-02T11:20:05.000Z",
  "folderPath": "Projects/Web",
  "path": "Projects/Web/Deployment",
  "warnings": []
}
```

### `update_note`

**Update note** · permission `edit` · writes

Replace a note's title and/or its whole body. Pass expected_version from your last read and a short reason. On version_conflict read the note again, merge your change and retry with the new version. To change one section use replace_section instead. Returns the new version (changed is false, and the version stays, when nothing differs). Requires the edit permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `expected_version` | integer ≥ 1 | yes |  | The note's version your change is based on, from your last read. If the note has a newer version, nothing is written and the tool fails with version_conflict. |
| `title` | string, 1-200 chars | no |  | New title (same rules as for create_note); leave out to keep the title. |
| `body` | string | no |  | New Markdown for the whole note, replacing the old body; leave out to keep it. To change one section use replace_section. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The note's id. |
| `version` | integer | The note's version now: the expected_version of your next write. |
| `changed` | boolean | false when the write changed nothing; then no version was written and the reason was dropped. |
| `updatedAt` | string (ISO 8601) | When the version was written. |
| `folderPath` | string | The note's folder path now; '' at the root level. |
| `path` | string | The note's path now (folderPath + '/' + title): usable as its address. |
| `warnings[]` | array | section_over_budget for each section whose own text is above the reading budget (code, path, approxTokens, budget, message): split it with more headings or read it in chunks. Nothing is refused. |
| `message` | string (only if changed is false) | Says that nothing was written, and why. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- `version_conflict`: The note has a newer version than expected_version (details: currentVersion, updatedAt, updatedBy, lastChange: change, reason, sectionPath). Nothing was written.
- `title_taken`: The folder already has a note with this title, case ignored (details: existingNoteId, path).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "expected_version": 4,
  "title": "Naming rules",
  "reason": "Shorter title"
}
```

and result

```json
{
  "id": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "version": 5,
  "changed": true,
  "updatedAt": "2026-10-02T11:24:47.000Z",
  "folderPath": "Projects/Web",
  "path": "Projects/Web/Naming rules",
  "warnings": []
}
```

### `replace_section`

**Replace section** · permission `edit` · writes

Replace one section of a note, from its heading line on (with its subsections unless include_subsections is false), by the given Markdown, which should start with the heading line. Pass expected_version from your last read and a short reason. On version_conflict the error carries the section's current text: merge your change and retry with currentVersion. Returns the new version. Requires the edit permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `expected_version` | integer ≥ 1 | yes |  | The note's version your change is based on, from your last read. If the note has a newer version, nothing is written and the tool fails with version_conflict. |
| `section` | string, 1-2000 chars | yes |  | Section path as read_outline or search_notes give it ('Setup > Docker'), or its end down to the last heading alone ('Docker') when that names one section only; a heading that occurs more than once fails with ambiguous_section and lists the candidates. Case is ignored. The text before the first heading is '(introduction)'. |
| `body` | string | yes |  | Markdown replacing the section from its heading line on. Start it with the heading line (the same or a new one); an empty string removes the section. When a heading follows and the text does not end with a blank line, one is added. |
| `include_subsections` | boolean | no | `true` | Replace the subsections as well (default true): the same range read_section returns. With false only the section's own text up to its first subsection is replaced. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The note's id. |
| `version` | integer | The note's version now: the expected_version of your next write. |
| `changed` | boolean | false when the write changed nothing; then no version was written and the reason was dropped. |
| `updatedAt` | string (ISO 8601) | When the version was written. |
| `folderPath` | string | The note's folder path now; '' at the root level. |
| `path` | string | The note's path now (folderPath + '/' + title): usable as its address. |
| `warnings[]` | array | section_over_budget for each section whose own text is above the reading budget (code, path, approxTokens, budget, message): split it with more headings or read it in chunks. Nothing is refused. |
| `message` | string (only if changed is false) | Says that nothing was written, and why. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- `section_not_found`: The note has no such section; paths lists the ones it has, section repeats yours.
- `ambiguous_section`: The path's end (e.g. a heading that occurs twice) names several sections; candidates lists their full paths, section repeats the one you gave.
- `version_conflict`: As for update_note; details also carry currentSection (path, text), the section's current text, or null when it is gone.
- `invalid_input`: Also when the note would exceed 1 MiB after the replacement (fields.body: too_long).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "Projects/Web/Naming conventions",
  "expected_version": 4,
  "section": "Naming conventions > Branches",
  "body": "## Branches\n\nUse `feature/<topic>`, `fix/<topic>` and `docs/<topic>` in kebab-case.\n",
  "reason": "Add the docs/ prefix"
}
```

and result

```json
{
  "id": "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  "version": 5,
  "changed": true,
  "updatedAt": "2026-10-02T11:31:12.000Z",
  "folderPath": "Projects/Web",
  "path": "Projects/Web/Naming conventions",
  "warnings": []
}
```

### `move_note`

**Move note** · permission `move` · writes

Move a note into another folder (folder_id null: the root level); its id stays the same. Pass expected_version from your last read and a short reason. Returns the new version and path. Fails with title_taken when the target folder already has a note with that title. Requires the move permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `expected_version` | integer ≥ 1 | yes |  | The note's version your change is based on, from your last read. If the note has a newer version, nothing is written and the tool fails with version_conflict. |
| `folder_id` | string (uuid) \| null | yes |  | Target folder id, or null for the root level. Must be given. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The note's id. |
| `version` | integer | The note's version now: the expected_version of your next write. |
| `changed` | boolean | false when the write changed nothing; then no version was written and the reason was dropped. |
| `updatedAt` | string (ISO 8601) | When the version was written. |
| `folderPath` | string | The note's folder path now; '' at the root level. |
| `path` | string | The note's path now (folderPath + '/' + title): usable as its address. |
| `warnings[]` | array | section_over_budget for each section whose own text is above the reading budget (code, path, approxTokens, budget, message): split it with more headings or read it in chunks. Nothing is refused. |
| `message` | string (only if changed is false) | Says that nothing was written, and why. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- `version_conflict`: The note has a newer version than expected_version (details: currentVersion, updatedAt, updatedBy, lastChange: change, reason, sectionPath). Nothing was written.
- `folder_not_found`: The target folder does not exist.
- `folder_in_trash`: That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, batchId; batchRootId and batchRootPath when it went with a folder above it, which restore_folder takes); restore it with restore_folder first.
- `forbidden`: The target (or the root level) is outside this token's folders (reason: outside_scope).
- `title_taken`: The folder already has a note with this title, case ignored (details: existingNoteId, path).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "expected_version": 2,
  "folder_id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "reason": "Checklists live in Runbooks"
}
```

and result

```json
{
  "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "version": 3,
  "changed": true,
  "updatedAt": "2026-10-02T11:40:58.000Z",
  "folderPath": "Projects/Runbooks",
  "path": "Projects/Runbooks/Release checklist",
  "warnings": []
}
```

### `create_folder`

**Create folder** · permission `create` · writes

Create a folder inside a parent folder, or at the root level when parent_id is left out. Returns its id and path. Folders have no versions; the reason is recorded in the audit log. Requires the create permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `parent_id` | string (uuid) | no |  | Parent folder id; leave out to create the folder at the root level. |
| `name` | string, 1-120 chars | yes |  | Folder name: unique among its siblings (case is ignored), max 120 characters, no '/' or line breaks. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: recorded in the audit log next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The folder's id; never changes. |
| `name` | string | The folder's name. |
| `parentId` | string \| null | The parent folder; null for the root level (or outside). |
| `parentOutsideScope` | boolean | Always false here: the parent must be in your folders. |
| `path` | string | Folder names from the root joined by '/'. |

**Errors**

- `folder_not_found`: The parent folder does not exist.
- `folder_in_trash`: The parent folder is in the trash (details: folderId, path, deletedAt, purgeAt, batchId, batchRootId/batchRootPath when it went with a folder above it).
- `forbidden`: The parent (or the root level) is outside this token's folders (reason: outside_scope).
- `name_taken`: The parent already has a folder with this name, case ignored (details: existingFolderId, path): choose another name, or rename that folder first.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "parent_id": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
  "name": "Runbooks",
  "reason": "Collect the operating guides"
}
```

and result

```json
{
  "id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "name": "Runbooks",
  "parentId": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
  "parentOutsideScope": false,
  "path": "Projects/Runbooks"
}
```

### `rename_folder`

**Rename folder** · permission `edit` · writes

Give a folder a new name; its id, its contents and the notes' ids stay the same, the paths below it change. Folders keep no history, so there is no expected_version; the reason is recorded in the audit log. Returns the folder with its new path. Requires the edit permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | yes |  | The folder to rename (from get_overview or list_folder). |
| `name` | string, 1-120 chars | yes |  | New name: unique among its siblings (case is ignored), max 120 characters, no '/' or line breaks. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: recorded in the audit log next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The folder's id; never changes. |
| `name` | string | The folder's name. |
| `parentId` | string \| null | The parent folder; null for the root level (or outside). |
| `parentOutsideScope` | boolean | true when the parent lies outside this token's folders (a folder it is limited to): then parentId is null. |
| `path` | string | Folder names from the root joined by '/'. |

**Errors**

- `folder_not_found`: No folder in use that this token can see has that id.
- `folder_in_trash`: That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, batchId; batchRootId and batchRootPath when it went with a folder above it, which restore_folder takes); restore it with restore_folder first.
- `name_taken`: The parent already has a folder with this name, case ignored (details: existingFolderId, path): choose another name, or rename that folder first.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "name": "Playbooks",
  "reason": "Match the team's wording"
}
```

and result

```json
{
  "id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "name": "Playbooks",
  "parentId": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
  "parentOutsideScope": false,
  "path": "Projects/Playbooks"
}
```

### `move_folder`

**Move folder** · permission `move` · writes

Move a folder with everything in it into another parent folder (parent_id null: the root level). Ids stay the same, the paths below it change. A folder cannot move into itself or one of its subfolders. Folders keep no history, so there is no expected_version; the reason is recorded in the audit log. Returns the folder with its new path. Requires the move permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | yes |  | The folder to move, with everything in it. |
| `parent_id` | string (uuid) \| null | yes |  | The new parent folder's id, or null for the root level. Must be given. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: recorded in the audit log next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The folder's id; never changes. |
| `name` | string | The folder's name. |
| `parentId` | string \| null | The parent folder; null for the root level (or outside). |
| `parentOutsideScope` | boolean | true when the parent lies outside this token's folders (a folder it is limited to): then parentId is null. |
| `path` | string | Folder names from the root joined by '/'. |

**Errors**

- `folder_not_found`: folder_id or parent_id names no folder in use this token can see.
- `folder_in_trash`: The folder or the target parent is in the trash (details: folderId, path, deletedAt, purgeAt, batchId, batchRootId/batchRootPath when it went with a folder above it).
- `forbidden`: The parent (or the root level) is outside this token's folders (reason: outside_scope).
- `name_taken`: The parent already has a folder with this name, case ignored (details: existingFolderId, path): choose another name, or rename that folder first.
- `folder_cycle`: parent_id is the folder itself or one of its subfolders (details: folderId, path of the folder; parentId, parentPath of the target).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "parent_id": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
  "reason": "Runbooks belong to the web project"
}
```

and result

```json
{
  "id": "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73",
  "name": "Runbooks",
  "parentId": "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
  "parentOutsideScope": false,
  "path": "Projects/Web/Runbooks"
}
```

### `delete_note`

**Delete note** · permission `delete` · moves to the trash

Move a note to the trash: it disappears from reads, search and listings, its title is free again, and the deletion is a new version with your reason. Restorable with restore_note / restore_folder until the server purges it after the retention period (the server instructions name its days; default 28). Agents cannot delete anything for good. Pass expected_version from your last read. Requires the delete permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note` | string, 1-4000 chars | yes |  | The note: its id (preferred: ids never change), its title, or folder path + title ('Projects/Naming conventions'; '/Title' for the root level). A title several notes share fails with ambiguous_note and lists the candidates. |
| `expected_version` | integer ≥ 1 | yes |  | The note's version your change is based on, from your last read. If the note has a newer version, nothing is written and the tool fails with version_conflict. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | "note" | Always note. |
| `version` | integer | The version the deletion wrote (change: deleted). |
| `id` | string (uuid) | Its id: pass it to restore_note or restore_folder. |
| `path` | string | Where it was: restoring brings it back there. |
| `deletedAt` | string (ISO 8601) | When it was moved to the trash. |
| `purgeAt` | string (ISO 8601) | When the server deletes it for good. |
| `batchId` | string (uuid) | What was deleted together shares this id. |

**Errors**

- `not_found`: No note this token can see has that id, title or path.
- `ambiguous_note`: Several notes have that title; candidates lists their ids and paths.
- `in_trash`: The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where it was; batchRootId and batchRootPath when it went with a folder); restore it with restore_note (or that folder with restore_folder) to use it.
- `version_conflict`: The note has a newer version than expected_version (details as for update_note). Nothing was deleted.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "expected_version": 2,
  "reason": "Replaced by the release runbook"
}
```

and result

```json
{
  "kind": "note",
  "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "version": 3,
  "path": "Projects/Release checklist",
  "deletedAt": "2026-10-02T12:00:00.000Z",
  "purgeAt": "2026-10-30T12:00:00.000Z",
  "batchId": "0b7d4e12-93a5-4c6f-8e21-5f9a3c7d1b84"
}
```

### `delete_folder`

**Delete folder** · permission `delete` · moves to the trash

Move a folder with all its subfolders and notes to the trash, as one batch: restoring the folder brings all of it back. Every note taken along gets a new version with your reason. Restorable with restore_note / restore_folder until the server purges it after the retention period (the server instructions name its days; default 28). Agents cannot delete anything for good. Requires the delete permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | yes |  | The folder to move to the trash, with all its subfolders and notes (from get_overview or list_folder). |
| `reason` | string, ≤ 500 chars | no |  | Why you delete it, one short sentence (max 500 characters). Optional but expected: recorded with every note it takes along. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | "folder" | Always folder. |
| `id` | string (uuid) | Its id: pass it to restore_note or restore_folder. |
| `path` | string | Where it was: restoring brings it back there. |
| `deletedAt` | string (ISO 8601) | When it was moved to the trash. |
| `purgeAt` | string (ISO 8601) | When the server deletes it for good. |
| `batchId` | string (uuid) | What was deleted together shares this id. |
| `folderCount` | integer | Subfolders moved along with it. |
| `noteCount` | integer | Notes moved along with it. |

**Errors**

- `folder_not_found`: No folder in use that this token can see has that id.
- `folder_in_trash`: The folder is in the trash already (details: folderId, path, deletedAt, purgeAt, batchId, batchRootId/batchRootPath when it went with a folder above it).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
  "reason": "Old material, no longer needed"
}
```

and result

```json
{
  "kind": "folder",
  "id": "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
  "path": "Projects/Archive",
  "deletedAt": "2026-10-02T12:05:00.000Z",
  "purgeAt": "2026-10-30T12:05:00.000Z",
  "batchId": "a3e81c5f-27d9-4b60-9f14-6c0e8b2d7a39",
  "folderCount": 1,
  "noteCount": 4
}
```

### `list_trash`

**List trash** · permission `delete` · read-only

List what is in the trash, newest first: notes and folders deleted on their own, and for a folder deleted with its contents the folder alone, with how many subfolders and notes went with it. Each entry has its id (for restore_note / restore_folder), its path before deletion, who deleted it, when, and when it will be purged. Only items that lay in this token's folders are listed. Requires the delete permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | no |  | List only what lay inside this folder (in use or in the trash) or below it; leave out to list the whole trash this token can see. |
| `limit` | integer 1-500 | no | `50` | Maximum entries, newest first (default 50). |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `retentionDays` | integer | Days items stay in the trash before they are purged. |
| `entries[]` | array | Newest first. |
| `entries[].kind` | "note" \| "folder" | What it is. |
| `entries[].id` | string (uuid) | Pass it to restore_note or restore_folder. |
| `entries[].name` | string | The note's title or the folder's name. |
| `entries[].path` | string | Its path before it was deleted. |
| `entries[].parentId` | string \| null | Where it was (a note's folder, a folder's parent); null for the root level or a parent outside this token's folders. |
| `entries[].parentPath` | string \| null | That folder's path; '' for the root level, null for a parent outside this token's folders. |
| `entries[].deletedAt` | string (ISO 8601) | When it was deleted. |
| `entries[].deletedBy` | string | Who deleted it: username or token name. |
| `entries[].purgeAt` | string (ISO 8601) | When the server deletes it for good. |
| `entries[].batchId` | string (uuid) | What was deleted together shares this id. |
| `entries[].version` | integer (notes) | The version the deletion wrote. |
| `entries[].folderCount` | integer (folders) | Subfolders deleted with it. |
| `entries[].noteCount` | integer (folders) | Notes deleted with it. |
| `hasMore` | boolean | More entries than limit. |

**Errors**

- `folder_not_found`: folder_id names no folder this token can see.
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "limit": 20
}
```

and result

```json
{
  "retentionDays": 28,
  "entries": [
    {
      "kind": "folder",
      "id": "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
      "name": "Archive",
      "path": "Projects/Archive",
      "parentId": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
      "parentPath": "Projects",
      "deletedAt": "2026-10-02T12:05:00.000Z",
      "deletedBy": "docs-agent",
      "purgeAt": "2026-10-30T12:05:00.000Z",
      "batchId": "a3e81c5f-27d9-4b60-9f14-6c0e8b2d7a39",
      "folderCount": 1,
      "noteCount": 4
    },
    {
      "kind": "note",
      "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
      "name": "Release checklist",
      "path": "Projects/Release checklist",
      "parentId": "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
      "parentPath": "Projects",
      "deletedAt": "2026-10-02T12:00:00.000Z",
      "deletedBy": "alex",
      "purgeAt": "2026-10-30T12:00:00.000Z",
      "batchId": "0b7d4e12-93a5-4c6f-8e21-5f9a3c7d1b84",
      "version": 3
    }
  ],
  "hasMore": false
}
```

### `restore_note`

**Restore note** · permission `delete` · writes

Bring a note back from the trash, by its id: into the folder it was deleted from, or into folder_id when given, under its old title or title when given. The restore is a new version with your reason. Fails with parent_in_trash when that folder is in the trash too (restore the folder, or pass folder_id), and with title_taken when a note there has its title now (pass another title or folder_id). Requires the delete permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `note_id` | string (uuid) | yes |  | Id of the note in the trash (from list_trash or delete_note). |
| `folder_id` | string (uuid) \| null | no |  | Restore into this folder instead (null: the root level); leave out to restore it where it was. Needed when its folder is in the trash and should stay there. |
| `title` | string, 1-200 chars | no |  | Restore it under this title instead (unique within the folder, case is ignored, max 200 characters); leave out to keep its title. Needed when a note there has its title now. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The note's id. |
| `version` | integer | The note's version now: the expected_version of your next write. |
| `changed` | boolean | false when the write changed nothing; then no version was written and the reason was dropped. |
| `updatedAt` | string (ISO 8601) | When the version was written. |
| `folderPath` | string | The note's folder path now; '' at the root level. |
| `path` | string | The note's path now (folderPath + '/' + title): usable as its address. |
| `warnings[]` | array | section_over_budget for each section whose own text is above the reading budget (code, path, approxTokens, budget, message): split it with more headings or read it in chunks. Nothing is refused. |
| `message` | string (only if changed is false) | Says that nothing was written, and why. |

**Errors**

- `not_found`: No note this token can see has that id.
- `note_not_deleted`: The note is not in the trash.
- `parent_in_trash`: The folder it would come back into is in the trash itself (details: folderId, path): restore that folder first, or (restore_note) pass folder_id.
- `folder_not_found`: folder_id names no folder this token can see.
- `forbidden`: The target (or the root level) is outside this token's folders (reason: outside_scope).
- `title_taken`: The folder has a note with this title now (details: existingNoteId, path): restore with another title (title) or into another folder (folder_id).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "note_id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "reason": "Still needed for the next release"
}
```

and result

```json
{
  "id": "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  "version": 4,
  "changed": true,
  "updatedAt": "2026-10-03T08:15:00.000Z",
  "folderPath": "Projects",
  "path": "Projects/Release checklist",
  "warnings": []
}
```

### `restore_folder`

**Restore folder** · permission `delete` · writes

Bring a folder back from the trash, by its id, together with everything that was deleted with it (its batch); items deleted on their own before stay in the trash. Each note that comes back gets a new version with your reason. The answer counts the subfolders (restoredSubfolders, not the folder itself) and notes that came back. Fails with parent_in_trash when its parent folder is in the trash (restore that one first) and with name_taken when a folder there has its name now. Requires the delete permission.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `folder_id` | string (uuid) | yes |  | Id of the folder in the trash (from list_trash or delete_folder): the folder it was deleted with, not one inside it. |
| `reason` | string, ≤ 500 chars | no |  | Why you make this change, one short sentence (max 500 characters). Optional but expected: shown in the note's history next to this token's name. |

**Result**

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (uuid) | The folder's id. |
| `name` | string | The folder's name. |
| `path` | string | Its path, in use again. |
| `batchId` | string (uuid) | The batch it was deleted with; everything in it is back. |
| `restoredSubfolders` | integer | Subfolders that came back with it; the folder itself is not counted. |
| `restoredNotes` | integer | Notes that came back with it, each as a new version with your reason. |

**Errors**

- `folder_not_found`: No folder this token can see has that id.
- `folder_not_deleted`: The folder is not in the trash.
- `parent_in_trash`: The folder it would come back into is in the trash itself (details: folderId, path): restore that folder first, or (restore_note) pass folder_id.
- `name_taken`: A folder in use has its name there now (details: existingFolderId, path).
- the [common errors](#errors) every tool can return.

**Example**: arguments

```json
{
  "folder_id": "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
  "reason": "Deleted by mistake"
}
```

and result

```json
{
  "id": "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
  "name": "Archive",
  "path": "Projects/Archive",
  "batchId": "a3e81c5f-27d9-4b60-9f14-6c0e8b2d7a39",
  "restoredSubfolders": 1,
  "restoredNotes": 4
}
```

<!-- END GENERATED: mcp-tools -->

## Errors

A failed tool call sets `isError: true` and sends a JSON object as its text:
`error` (the code), `message` (a short English explanation) and, for some
codes, details. The codes are the same as in the HTTP API.

| Code | Meaning | What the agent should do |
|---|---|---|
| `not_found` | No note visible to this token matches, or the note has no such version (`read_revision`). | Check the address; find the note with `search_notes` or `list_folder`. |
| `folder_not_found` | No folder visible to this token has that id (or it was deleted meanwhile). | Get folder ids from `get_overview` or `list_folder`. |
| `section_not_found` | The note has no such section. `paths` lists up to 50 of its section paths; `section` repeats the path you gave. | Pick a path from `paths` or call `read_outline`. |
| `ambiguous_note` | Several notes have that title. `candidates` lists up to 20 with `id` and `path`. | Repeat with the id or path of the right candidate. |
| `ambiguous_section` | The path's end fits several sections (e.g. a heading that occurs twice). `candidates` lists their full paths; `section` repeats the path you gave. | Repeat with the full path. |
| `version_conflict` | The note has a newer version than `expected_version`. Details: `currentVersion`, `updatedAt`, `updatedBy`, `lastChange` (`change`, `reason`, `sectionPath`), and for `replace_section` `currentSection`. Nothing was written. | Read again, merge your change, retry with `currentVersion`. |
| `title_taken` | The folder already has a note with this title (ignoring case). Details: `existingNoteId`, `path`. | Choose another title, or update the existing note; when restoring, pass another `title` or restore into another `folder_id`. |
| `name_taken` | The parent already has a folder with this name (ignoring case): creating, renaming, moving or restoring a folder. Details: `existingFolderId`, `path`. | Use the existing folder, choose another name, or rename or move that folder first. |
| `folder_cycle` | `move_folder` named the folder itself or one of its subfolders as the new parent. Details: `folderId`, `path` (the folder), `parentId`, `parentPath` (the target inside it). | Choose a parent outside the folder's subtree. |
| `in_trash` | The note named by its id is in the trash. Details: `deletedAt`, `purgeAt`, `batchId`, `path` (where it was); `batchRootId`, `batchRootPath` when it went with a folder. | Restore it with `restore_note` if it is still needed (or the folder with `restore_folder`). |
| `folder_in_trash` | The folder named by its id is in the trash (only for a folder inside the token's folders; outside them `folder_not_found`). Details: `folderId`, `path` (where it was), `deletedAt`, `purgeAt`, `batchId`; `batchRootId`, `batchRootPath` when it went with a folder above it (left out when that folder lies outside the token's folders). | Restore it with `restore_folder`: `batchRootId` when given, else `folderId`; or use another folder. |
| `parent_in_trash` | The folder a note or folder would be restored into is in the trash itself. Details: `folderId`, `path`. | Restore that folder first (`restore_folder`), or pass `folder_id` to `restore_note`. |
| `note_not_deleted` | `restore_note` named a note that is not in the trash. | Nothing to restore; use the note. |
| `folder_not_deleted` | `restore_folder` named a folder that is not in the trash. | Nothing to restore; use the folder. |
| `forbidden` | The token lacks the permission (`permission` names it), or the target folder is outside its folders (`reason: "outside_scope"`). Over HTTP also `reason: "session_required"` (deleting for good) and `"admin_required"` (emptying the trash). | Do not retry; tell the user which permission or folder access is needed. |
| `invalid_input` | An argument breaks its rule. `fields` has one entry per argument: `code` (as in the HTTP API: `required`, `empty`, `invalid_type`, `too_long`, `invalid_format`, `invalid`), `params` where useful (e.g. `max`) and `rule`, an English sentence such as `title must not be empty` or `title must not contain '/' or control characters such as line breaks and tabs`. Also when the note would exceed 1 MiB after `replace_section` (`fields.body`). Nothing was written. | Fix the named arguments and call again. |
| `token_revoked` | The token was revoked. | Stop; ask the user for a new token. |
| `token_expired` | The token has expired. | Stop; ask the user for a new token. |
| `setup_token_present` | The server's first-run setup is not finished; no token works. | Stop; tell the user to finish the setup. |
| `database_unavailable` | The database cannot be reached or is not migrated yet. | Retry later. |
| `server_not_configured` | The server lacks a required setting. | Stop; tell the user (administrator). |

Invalid arguments (a missing or empty parameter, a wrong type, a value out of
range, a malformed id or time) are answered in this shape too, as
`invalid_input`, before the tool does anything. An unknown tool name is a
JSON-RPC error (`-32602`).

One kind of failure does not have this shape:

- **Refused requests**: a missing or unknown token (`unauthenticated`), a
  revoked or expired token, `setup_token_present`, `database_unavailable`
  and `server_not_configured` usually stop the request at HTTP level, before
  any tool runs: status 401, 403 or 503 with a JSON body `{ "error": "<code>" }`.
  A request body above 4 MiB is refused as too large.

## HTTP API and limits

### HTTP API

The web app and scripts use the same operations over HTTP at `/api/notes/v1`
(session or the same bearer token), with the same permission checks and
error codes; it also offers what MCP has no tool for: deleting from the
trash for good, which only signed-in people can do, with the password
re-entered in the last 10 minutes (an API token gets 403 there). The OpenAPI document is served at
`/api/notes/v1/openapi.json`; the contract is described in
`apps/server/src/api/notes/v1/index.ts`.

### Limits

| What | Limit |
|---|---|
| Note body | 1 MiB (UTF-8), also after `replace_section` |
| Note title | 200 characters, no `/` or line breaks |
| Folder name | 120 characters, no `/` or line breaks |
| Reason | 500 characters |
| Search query | 500 characters |
| `search_notes` hits | default 20, max 50 |
| `list_folder` depth | default 1, max 10 |
| `get_overview` tree | 2 levels |
| `list_changes` notes | default 100, max 500 |
| `list_trash` entries | default 50, max 500 |
| Trash retention | `TRASH_RETENTION_DAYS`, default 28 days (1 to 3650) |
| Reading budget per section | `SECTION_TOKEN_BUDGET`, default 8000 estimated tokens (100 to 1,000,000); advice, not a limit |
| `ambiguous_note` candidates | at most 20 |
| `section_not_found` paths | at most 50 |
| MCP request body | 4 MiB |
