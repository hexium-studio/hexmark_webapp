# Notes and agent access – design

Status: **draft for review** · Scope: milestone 1 (notes core + agent access via MCP).

Hexmark is a wiki for agents first and humans second. This milestone delivers the core that both
use: notes in folders, revisions, search, API tokens and the MCP server. The browser UI for notes
follows in milestone 2 and uses the same HTTP API.

## 1. Principles applied

- **Stable IDs:** notes and folders are addressed by UUIDs. Renaming or moving never changes an ID.
- **Every change is a revision:** with the actor's *name* (see 2.4), time and an optional reason.
- **Optimistic concurrency:** a write states the version it is based on; a mismatch is a conflict,
  never a silent overwrite.
- **Context-efficient reads:** overview, outline, single section, search snippets, changes since.
- **One service layer:** HTTP API and MCP tools call the same services and the same permission
  checks.

## 2. Data model (new migrations)

### 2.1 `folders`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| parent_id | uuid null → folders | null = root level; `on delete restrict` |
| name | text | 1–120 chars, no `/`, trimmed |
| created_at / updated_at | timestamptz | |
| created_by / updated_by | actor (2.4) | |
| deleted_at | timestamptz null | trash |
| deleted_by / trash_batch_id | actor (2.4), uuid | who moved it to the trash, and with which batch (2.6) |

Unique `(parent_id, lower(name))` among non-deleted folders (root handled with a partial index).
Folder depth is not limited; cycles are rejected when moving.

### 2.2 `notes`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| folder_id | uuid null → folders | null = root level |
| title | text | 1–200 chars |
| body | text | Markdown, max 1 MB |
| metadata | jsonb | front matter, default `{}` (needed for import/export) |
| version | integer | starts at 1, +1 on every content, title or location change |
| search | tsvector, generated | title weight A + body weight B, `simple` configuration |
| created_at / updated_at | timestamptz | |
| created_by / updated_by | actor (2.4) | |
| deleted_at | timestamptz null | trash, purged after the retention (2.6) |
| deleted_by / trash_batch_id | actor (2.4), uuid | who moved it to the trash, and with which batch (2.6) |
| locked_at / locked_by | timestamptz / actor, null | column now, rules in a later milestone |
| hidden | boolean default false | column now, rules in a later milestone |

Unique `(folder_id, lower(title))` among non-deleted notes – keeps export paths unambiguous.
GIN index on `search`; index on `updated_at` for "changed since".

### 2.3 `note_revisions`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| note_id | uuid → notes (cascade) | |
| version | integer | unique with note_id |
| title, body, folder_id, metadata | as in notes | full snapshot of every version (decided). A later UI shows any old version next to the current one with a line diff (added / changed / removed lines, GitHub style), computed on the fly |
| change | text | `created`, `edited`, `renamed`, `moved`, `deleted`, `restored` |
| reason | text null | max 500 chars, given by the actor |
| actor | actor (2.4) | |
| created_at | timestamptz | |

### 2.3a `note_sections` (derived, rebuilt on every write)

The Markdown body stays the single source of truth. On every write the server parses it with a real
Markdown parser (headings inside code blocks are ignored) and replaces the note's rows here:

| Column | Type | Notes |
|---|---|---|
| note_id | uuid → notes (cascade) | |
| position | integer | order in the note; pk with note_id |
| level | smallint | 0 = text before the first heading ("introduction"), 1–6 = `#`…`######` |
| heading | text | heading text as written |
| path | text | heading path for addressing, e.g. `Examples > Webapp vs. API`; duplicates get ` (2)` |
| parent_position | integer null | enclosing section |
| start_offset / end_offset | integer | own text range in the body (without subsections) |
| subtree_end_offset | integer | end including subsections |
| characters / approx_tokens | integer | size of the section incl. subsections; tokens are a heuristic (UTF-8 bytes / 4) – language-dependent, shown as an estimate |
| search | tsvector | per-section search (title of the note + heading weight A, text weight B) |

Sections are addressed by `path`; a section **includes its subsections by default** (agents can
ask for the section alone). There is **no hard size limit per section**: when a section's estimate
exceeds the reading budget (config `SECTION_TOKEN_BUDGET`, default 8000), the outline marks it and
writes return a warning suggesting a split. A note's body has a technical limit of 1 MB.

### 2.4 Actor

Every change records **who** did it, shown by name:

- **Humans:** the username (`users.username`).
- **Agents:** the name given when the API token was created (e.g. `claude-code-laptop`).

Stored as `actor_user_id` (set null on delete), `actor_token_id` (set null on delete) and
`actor_name` – a **snapshot** of the name at the time of the change, so history stays readable
after a token is revoked or a user is renamed. Exactly one of the two ids is set when written.
An agent's change is always also attributed to the token's owner via the token row.

### 2.5 `api_tokens`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid → users (cascade) | owner; a token never exceeds its owner's permissions |
| name | text | 1–64 chars, unique per user, shown as actor name |
| token_hash | text | SHA-256 hex; the token itself is shown once |
| token_prefix | text | first 8 chars for recognition, e.g. `hmk_3f9a…` |
| permissions | text[] | subset of: `read`, `search`, `create`, `edit`, `move`, `delete`, `lock` |
| folder_scope | uuid[] null | null = whole wiki; otherwise these folders and their subfolders |
| expires_at | timestamptz null | optional |
| last_used_at | timestamptz null | |
| created_at / revoked_at | timestamptz | |

Token format: `hmk_` + 32 random bytes base64url. Sent as `Authorization: Bearer <token>`.

After creation the UI shows the token **once**, together with one copyable block in the standard
`mcpServers` JSON format (language-neutral, no prose – agents and MCP clients understand it):

```json
{ "mcpServers": { "hexmark": { "type": "http", "url": "<MCP URL>",
  "headers": { "Authorization": "Bearer hmk_…" } } } }
```

The MCP URL comes from the optional env `MCP_PUBLIC_URL`; without it the web derives it from the
request host and `SERVER_PORT`. Above the block a short translated hint (not part of the copied text)
explains its use, e.g. "Give your agent the following configuration so it can set up the MCP server".
Permissions and folder scope are not in the block – the agent learns
them from `get_overview` after connecting.

### 2.6 Trash (decided 2026-10-03)

Deleting never removes rows at once: notes and folders move to the trash (`deleted_at`, the
`deleted_by` actor and a `trash_batch_id`, all set or all null together; migration `0007`).

- **Who:** agents (MCP) and humans (HTTP API) with the `delete` permission can delete, list the
  trash and restore. Deleting **for good** is for humans only (a session, never an API token:
  bearer tokens get 403 and MCP has no such tool), and emptying the whole trash for admins.
  Both are sensitive actions like creating an API token: the password must have been
  re-entered in the session within the last 10 minutes (`reauthentication_required`
  otherwise), checked on the locked session row inside the deleting transaction.
- **Folders:** deleting a folder moves it with its whole subtree (subfolders and notes) as **one
  batch**; restoring the folder restores that batch. Items deleted on their own earlier keep
  their own batch and stay in the trash.
- **Restoring a note** whose folder is in the trash is refused with `parent_in_trash` (naming
  the folder) unless a target `folder_id` is given. A title or name taken meanwhile gives
  `title_taken` / `name_taken` with the holder; a note can be restored under another
  `title`.
- **Revisions:** every note deletion and restore, also along with a folder, is a version with a
  `deleted` / `restored` revision (actor, reason).
- **Visibility:** items in the trash are left out of reads, search, the tree and addressing by
  title or path; a note in the trash named by its id answers `in_trash` (with `deletedAt`,
  `purgeAt`, `batchId`, `path`) to a caller who may see it, and a folder in the trash named
  by its id where a folder in use is expected (listing, search, a target folder, renaming,
  moving, deleting) answers `folder_in_trash` (`folderId`, `path`, `deletedAt`, `purgeAt`,
  `batchId`); both add `batchRootId` / `batchRootPath` - the folder the batch was deleted
  with, which `restore_folder` takes - when that is another folder the caller may see; outside the caller's
  folders both stay `not_found` / `folder_not_found`. `list_changes` lists it with
  `deleted: true`. A token
  limited to folders sees only trash items whose original location lies inside its folders.
- **Purge:** `TRASH_RETENTION_DAYS` (default 28, 1–3650). An item deleted at T is purged once
  now ≥ T + retention (day 29 by default). A job in the API server runs at start (after the
  migrations) and hourly, under a PostgreSQL advisory lock so parallel servers do not collide,
  deletes due notes (revisions and sections cascade) and then folders, children first, and logs
  the counts.

### 2.7 Audit log (decided 2026-10-04)

Everything a person or an agent does is recorded in the append-only table `audit_events`
(migration `0009`): who (username, token name or "System", as a snapshot), the source
(`web` for a session, `http` for a token over the HTTP API, `mcp`, `system` for jobs), the
action code (catalogue `AUDIT_ACTIONS` in `@hexmark/shared`), the outcome, an error code for
failures, the target (kind, id, path or name at the time), the reason and sanitized
details. A successful action writes its event in its own transaction; a refused or failed
one is written afterwards, in a transaction of its own, with the arguments summarized. An
agent's reads are logged, a person's never. No IP addresses, passwords, tokens, codes or
note bodies. A folder batch (to the trash, back, deleted for good, purged) is listed on the
folder's event (ids and paths, capped) and each note and subfolder gets an event of its own
naming the folder (`viaFolder`), so filtering by a note's id shows everything that happened
to it. A rejected API token is logged at most once per presented value in 10 minutes per
server (`suppressed` counts the ones left out). Retention `AUDIT_RETENTION_DAYS` (default
365), purged by the hourly job. Read with `GET /api/audit/v1/events` (sessions only; administrators see everything,
others their own and their tokens'). Details: [docs/audit.md](../audit.md).

## 3. Permissions

| Permission | Allows |
|---|---|
| read | read notes, outline, sections, revisions, tree |
| search | full-text search |
| create | create notes and folders |
| edit | change title and body, rename folders |
| move | move notes and folders |
| delete | move to trash, list the trash, restore (never delete for good) |
| lock | set *locked* (later milestone; humans lift) |

Humans in this milestone: admin and user have all note permissions, guest has `read` + `search`.
Fine-grained human permissions follow later. Token checks: permission in the token **and** in the
owner's role **and** the note inside `folder_scope`.

## 4. HTTP API (`/api/notes/v1`, `/api/tokens/v1`)

Session (humans, via the web) or bearer token (agents) – same services, same checks.

- `GET tree?folder&depth` – folders and note titles (no bodies)
- `GET notes/:id?view=full|outline|section&section=` – content + `version`
- `POST notes` – `{ folderId, title, body, metadata?, reason? }`
- `PATCH notes/:id` – `{ expectedVersion, title?, body?, reason? }`
- `PUT notes/:id/sections` – replace one section: `{ expectedVersion, heading, body, reason? }`
- `POST notes/:id/move` – `{ expectedVersion, folderId, reason? }`
- `DELETE notes/:id` – `{ expectedVersion, reason? }` → trash; `POST notes/:id/restore`
  `{ folderId?, title?, reason? }`
- `GET notes/:id/revisions`, `GET notes/:id/revisions/:version`
- `GET search?q&folder&limit` – id, title, path, heading (as written, no marks), snippet (`ts_headline`, finished: punctuation kept, phrases and hyphenated words as one mark, the parts of a hyphenated query word not marked elsewhere), version, rank relative to the best hit
- `GET changes?since=<timestamp>` – notes changed since, with change type and actor name
- Folders: `POST folders`, `PATCH folders/:id` (rename, permission edit, `reason?`), `POST folders/:id/move` (permission move, `reason?`),
  `DELETE folders/:id` (with its subtree into the trash), `POST folders/:id/restore`
- Trash: `GET trash?folder&limit` (entries with `parentId`/`parentPath`: where the item was);
  for good, sessions with the password re-entered recently only: `DELETE trash/notes/:id`,
  `DELETE trash/folders/:id`, `DELETE trash` (empty, admins only)
- Tokens (session only): `GET tokens`, `POST tokens` (returns the token once), `DELETE tokens/:id`

Errors as codes, as everywhere: `not_found`, `forbidden`, `version_conflict`, `title_taken`,
`validation`, `rate_limited`, … An OpenAPI document is generated from the Zod schemas.

### Conflicts

A write with a stale `expectedVersion` returns **409 `version_conflict`** with the current
`version`, `updatedAt`, actor name and – for a section write – the current section text. The
client (human or agent) re-reads and decides; nothing is merged automatically.

## 5. MCP server

- Endpoint `/mcp` on the API server, **Streamable HTTP** transport, bearer token auth.
- Official TypeScript SDK (`@modelcontextprotocol/sdk`).
- **Instructions** sent on connect (server instructions + resource `hexmark://guide`): what a
  note and a folder are, that IDs are stable, how links look (`[Title](hexmark:<id>)`, final
  syntax decided with links in a later milestone), that every write needs `expected_version`
  and should carry a short `reason`, and which permissions the current token has.

### Addressing notes

Wherever a tool takes `note`, it accepts the **id**, the **title** or the **folder path + title**
(`Projects/GitHub naming conventions`). Ambiguous names return `ambiguous_note` with the candidates
(id, path) so the agent can choose; internally everything uses the stable id.

### Tools (names in snake_case)

| Tool | Permission | Input | Output |
|---|---|---|---|
| `get_overview` | read | – | instance name, token permissions, folder tree (depth 2), counts |
| `list_folder` | read | `folder_id?`, `depth?` | folders + note titles with ids and versions |
| `search_notes` | search | `query`, `folder_id?`, `limit?` | per-section hits: note id, title, folder path, section path, snippet, version |
| `read_outline` | read | `note` | section tree: path, level, characters, approx_tokens, over-budget flag, version |
| `read_section` | read | `note`, `section` (path or its end), `include_subsections?` (default true), `offset?`, `limit?` (characters, for reading in pieces) | section text (or a piece: offset, returned, total, hasMore, nextOffset; past the end also requestedOffset) + version |
| `read_note` | read | `note` | whole body + version (with a hint to use the outline for large notes) |
| `list_changes` | read | `since` | changed notes with change type, actor name |
| `create_note` | create | `folder_id?`, `title`, `body`, `reason?` | id, version, path |
| `update_note` | edit | `note`, `expected_version`, `title?`, `body?`, `reason?` | new version |
| `replace_section` | edit | `note`, `expected_version`, `section` (path), `body`, `reason?` | new version |
| `move_note` | move | `note`, `expected_version`, `folder_id`, `reason?` | new version, path |
| `create_folder` | create | `parent_id?`, `name`, `reason?` | id, path (the reason goes to the audit log, 2.7) |
| `rename_folder` | edit | `folder_id`, `name`, `reason?` | id, path (folders keep no history: no version; the reason goes to the audit log, 2.7) |
| `move_folder` | move | `folder_id`, `parent_id` (null: root level), `reason?` | id, path |
| `list_revisions` | read | `note` | versions with time, actor name, change, reason, folder path, section path |
| `read_revision` | read | `note`, `version` | snapshot with `noteId` |
| `delete_note` | delete | `note`, `expected_version`, `reason?` | id, version, path, deletedAt, purgeAt, batch |
| `delete_folder` | delete | `folder_id`, `reason?` | id, path, deletedAt, purgeAt, batch, counts |
| `list_trash` | delete | `folder_id?`, `limit?` | entries (original path, parentId/parentPath, deletedBy, purgeAt, counts) |
| `restore_note` | delete | `note_id`, `folder_id?`, `title?`, `reason?` | new version, path |
| `restore_folder` | delete | `folder_id`, `reason?` | path, batchId, restoredSubfolders (not counting the folder itself), restoredNotes |

Lock tools come with locked/hidden in a later milestone; until then the token page does not
offer the `lock` permission. No tool deletes for good (2.6). Tool errors use the same codes
as the HTTP API, with a short English explanation for the agent; invalid arguments (the HTTP
API's `validation`) are `invalid_input` with a code and an English rule per field.

## 6. Acceptance criteria (milestone 1)

1. A user creates an API token on the account page (name + permissions), sees it once.
2. Claude Code (or another MCP client) connects to `/mcp` with that token and gets the guide.
3. The agent creates folders and notes, finds them by search with snippets, reads outline and
   single sections, edits with `expected_version`; a stale version yields `version_conflict`.
4. Every change appears in the revisions with the token's name; human changes via the HTTP API
   show the username.
5. A token without `edit` cannot write; a token scoped to a folder cannot read outside it.
6. Revoking the token stops access immediately.
7. All of it covered by unit, integration and e2e tests (MCP via the SDK client).

## 7. Out of scope here

Browser UI for notes (milestone 2; for tokens only a minimal account view now), links/backlinks, trash UI (the trash
itself and its purge are in scope, 2.6), the audit log UI (the log itself is in scope,
2.7), locked/hidden rules, attachments, import/export, real-time co-editing.
