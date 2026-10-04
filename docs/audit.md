# Audit log

Hexmark records what people and agents do in an append-only audit log: every
change, every sign-in, every change to an account's security, every API token,
the setup wizard, and everything an agent reads. Failed and refused attempts are
recorded too, so problems - an agent that keeps sending a stale version, a token
that was revoked, someone guessing passwords - can be found.

The log is a table in the database (`audit_events`). Until the log page of the
web app exists, it is read through the HTTP API (see [Reading the log](#reading-the-log)).

## What an event holds

| Field | Meaning |
|---|---|
| `occurredAt` | When it happened (UTC). |
| `actor.kind` | `human` (a signed-in person), `agent` (an API token) or `system` (the server's own jobs). |
| `actor.name` | The username, the token's name or `System`, **as it was then**. `unknown` for a sign-in with an e-mail that matches no account; `invalid token` for a request with an API token that matches no token. |
| `actor.userId` / `actor.tokenId` | The user or token, while it exists (deleting it empties the id; the name stays). |
| `source` | How the request came in: `web` (the browser, through the web app's session), `http` (an API token on the HTTP API), `mcp` (an API token on the MCP server), `system` (a job of the server). |
| `action` | What was done or tried, a code from the catalogue below. |
| `outcome` | `success` or `failure`. |
| `errorCode` | For failures: the code the client got (`version_conflict`, `forbidden`, `invalid_credentials`, …). |
| `target` | What it was about: `kind` (`note`, `folder`, `trash`, `user`, `token`, `security_key`, `settings`, `audit`), `id`, and `label` - the path or name at the time. |
| `reason` | The reason given with the action (notes, folders, the trash, locks, hiding). |
| `details` | Facts about the action, by kind: versions, the previous path or title, the section changed, sizes, counts, the trash batch, a token's access (mode, base permissions, entries) and what a change of it changed, a lock's holder, the hidden mark lifted, old and new settings. For failures: `input` (what was sent, summarized) and `refusal` (what the refusal said besides its code). |

**Never in the log:** passwords, API tokens (only their 8-character prefix, as the
token page shows it), session tokens and sign-in challenges, TOTP secrets and
codes, recovery codes, the setup token, note bodies (only their length), e-mail
addresses, and IP addresses. The server enforces this twice: failures keep only
known, harmless input fields, and every event's details pass a filter that drops
fields named like secrets, shortens long texts (search queries to 200
characters) and keeps the details below 16 KB.

## How events are written

- A **successful** action writes its event in the same database transaction as
  the action itself: the event exists exactly when the action took effect. If
  the event cannot be written, the action is rolled back.
- A **refused or failed** action is rolled back first; its event is written
  afterwards, in a transaction of its own, with the error code and the input
  summarized.
- The table refuses `UPDATE`, and `DELETE` and `TRUNCATE` except for the
  retention purge (database triggers, migration `0009`).

## What is logged

One event per action, unless noted. Every action can also appear with
`outcome: failure` (e.g. `note.updated` refused with `version_conflict`).

| Area | Actions |
|---|---|
| Notes | `note.created`, `note.updated` (title and/or body; `details.change` is `edited` or `renamed`; `changed: false` when nothing differed), `note.section_replaced` (`sectionPath`), `note.moved` (`previousPath`), `note.deleted` (to the trash, `batchId`), `note.restored`; both also for each note of a folder batch, with `viaFolder` (see [Folder batches](#folder-batches)) |
| Folders | `folder.created`, `folder.renamed`, `folder.moved` (all three with the `reason` the folder tools and endpoints take), `folder.deleted` (the folder with `folderCount`, `noteCount` and the `items` of the batch; each subfolder with `viaFolder`), `folder.restored` (the folder with `restoredSubfolders`, `restoredNotes` and the `items`; each subfolder with `viaFolder`) |
| Deleted for good | `note.deleted_permanently`, `folder.deleted_permanently`: one event **per note and folder removed**, sharing a `runId`, each naming its trash `batchId` and `via` (`note`, `folder`, `empty_trash`); the folder removed with what was below it lists those `items`, and each of them names it as `viaFolder`. Emptying the trash adds `trash.emptied` with the counts. |
| Locks | `note.locked`, `folder.locked` (the reason in `reason`; `details.changed: false` when it held a lock of its own already), `note.unlocked`, `folder.unlocked` (people only; `details` names the lock lifted: `lockedAt`, `lockedBy`, `lockReason`). Refused attempts too: an agent unlocking (`forbidden`), locking without a reason (`validation`) or inside a locked folder, and every write an agent tried on something locked (the write's own action with `error_code: locked` and `refusal.lockedItem`, `lockedBy`). |
| Hidden | `note.hidden`, `folder.hidden` (the reason in `reason`; `details.changed: false` when it was hidden itself already), `note.unhidden`, `folder.unhidden` (people only, with the password re-entered in the last 10 minutes; `details` names the mark lifted: `hiddenAt`, `hiddenBy`, `hideReason`). Refused attempts too: an agent unhiding (`forbidden`, `refusal.reason: session_required`), a person unhiding without a recent password (`reauthentication_required`), an agent hiding without a reason (`validation` / `invalid_input`), and every write or read an agent tried on something hidden (the write's or read's own action with `error_code: hidden` and `refusal.hiddenItem`, `hiddenAt`, `hiddenBy`, `reason`, and for writes `locked`: the lock that refused it as well, or null). The content of a hidden note never appears in these events. |
| Purge | `note.purged`, `folder.purged`: the trash purge as `System`, one event per item, sharing a `runId`; a folder batch is listed on its folder's event as for deleting for good. `audit.purged`: the audit purge, one event with the number of events removed. |
| Agent reads | `read.overview`, `read.folder`, `read.search` (the query, shortened), `read.outline`, `read.section` (section, offset, limit), `read.note`, `read.changes`, `read.revisions`, `read.revision`, `read.trash`, `read.locked` (the list of locked items over HTTP) - for API tokens (MCP and HTTP API) only. `read.hidden` (the list of hidden items) is for people only: an agent's attempt is logged as a failure (`forbidden`). **People's reads are never logged**, but their refused reads are. |
| Sign-in | `auth.sign_in` (with the method: `password`, `totp`, `webauthn`, `recovery_code`, `enrolment`), `auth.sign_in_failed` (`invalid_credentials` for an unknown e-mail or a wrong password, `rate_limited`), `auth.second_factor_verified` (success or failure, with the method; a recovery code with how many are left), `auth.sign_out`, `auth.reauthenticated` (the password re-entered; failures `invalid_password`, `rate_limited`). A session that ends by itself is not logged. |
| Second factors | `two_factor.totp_added`, `two_factor.totp_removed`, `two_factor.security_key_added`, `two_factor.security_key_renamed` (old and new name), `two_factor.security_key_removed`, `two_factor.recovery_codes_regenerated`; `details.context` says where: `account`, `sign_in_enrolment` or `setup`. |
| API tokens | `token.created` (prefix, `mode`, `basePermissions`, `entries` with kind, id, path and permissions, expiry), `token.updated` (see [Changing a token](#changing-a-token)), `token.revoked`, `token.entry_removed` (by `System`: an entry whose target was deleted for good, see below), `auth.token_rejected` (a request with a revoked, expired or unknown token; at most once per token value in 10 minutes, see [Rejected tokens](#rejected-tokens)). |
| Setup | `setup.admin_created`, `settings.changed` (old and new values). |
| The log | `audit.read`: a refused attempt to read the log (an agent, invalid filters). Reading it is not logged. |

`GET /api/audit/v1/actions` returns this catalogue with a description, the
target kind and the outcomes of each code.

**Not logged:** requests without a valid session; a `Bearer` header that is not
an API token at all; a second-factor answer with an unknown or expired sign-in
challenge (it names no account); refused attempts of the setup wizard before the
first account exists; people listing their own tokens or opening their security
page; repeated requests with the same API token that does not work, within 10
minutes of the one logged ([Rejected tokens](#rejected-tokens)).

## Folder batches

A folder goes to the trash with its subfolders and notes as one batch, comes
back as one, and is deleted for good (by a person, or by the purge) with
everything below it. Such an action writes:

- **The folder's event** (`folder.deleted`, `folder.restored`,
  `folder.deleted_permanently`, `folder.purged`) with the counts and
  `details.items`: every subfolder and note of the batch as
  `{ kind, id, path }`, with the path it had then. The list is sorted by
  path (then folders before notes, then id) and cut so the details stay below
  their size limit: at most 50 items and about 8 KB. A cut list adds
  `itemsTruncated: true` and `itemsTotal` (the counts hold the totals too).
  The same batch always gives the same list.
- **One event per subfolder and note** with the same action kind
  (`folder.deleted` / `note.deleted`, `folder.restored` / `note.restored`,
  `…deleted_permanently`, `…purged`), the same reason and batch, and
  `details.viaFolder: { id, path }` naming the folder the batch went with. A
  note's event also has its new `version` (to the trash and back).

So the question "what happened to note X, and who did it" is answered by
filtering on the note's id alone (`targetKind=note&targetId=<id>`), also when
the note went along with a folder; the folder's own event answers "what did
this deletion take along". Events with `viaFolder` belong to the folder's
action: to count folder deletions, filter for events without it (or by the
folder's id). Deleting for good and the purge always worked per item; their
folder's event now lists the items too, and each item names the folder (the
topmost one removed with it in that run) as `viaFolder`.

## Changing a token

`token.updated` records exactly what a change of a token's access did, in
`details`:

- `mode`, `basePermissions`, `expiresAt`: `{ before, after }`, each only
  when it changed;
- `addedEntries`, `removedEntries`: the entries as `{ kind, id, path,
  permissions }` (permissions null on a deny list);
- `changedEntries`: `{ kind, id, path, before, after }` with the
  permissions of an entry that stayed;
- `changed`: false when nothing differed (the event is written anyway).

A new mode replaces every entry: all old ones are in `removedEntries`, all
new ones in `addedEntries`. Lists longer than 50 are cut like any detail
list. A refused change (no recent password, invalid access) is logged as a
failure with the input summarized.

When a note or folder is deleted for good (by a person or by the purge),
the database removes the token entries pointing at it. Each removed entry is
logged as `token.entry_removed` by `System` (source `system`), whoever
deleted the item, in the same transaction: the token as target, and in
`details` the `entryId`, the token's `mode`, the entry's `permissions`,
the target (`targetKind`, `targetId`, `targetPath`), `cause:
"target_deleted_permanently"`, `via` and the `runId` of the removal's own
events. An entry whose target only goes to the trash stays.

## Rejected tokens

A request with an API token that is unknown, revoked or expired is logged as
`auth.token_rejected` at most **once per token value in 10 minutes**: the
first request opens the window, further requests with the same value in it are
only counted, and the first one after it is logged with `details.suppressed`,
the number left out. The value is recognised by its digest, never stored;
the HTTP API and MCP count together. The counts are kept in the memory of each
server process (several servers each log once; a restart starts again), for at
most 10,000 values at a time - beyond that the oldest are forgotten, so a
client sending ever new values is still logged once per value.

## Retention

Events are kept for `AUDIT_RETENTION_DAYS` days (default 365, 1 to 3650; an
invalid value is logged at start-up and the default applies). An event written
at time T is deleted once T + retention has passed. The server checks at start
and then every hour, together with the trash purge; several servers on one
database take turns.

## Visibility

- **Administrators** see every event.
- **Other people** see the events they caused themselves and those of their API
  tokens.
- **Agents** cannot read the log: an API token gets `403 forbidden`
  `{ reason: "session_required" }`, and the attempt is logged.

## Reading the log

`GET /api/audit/v1/events` with a session (`Authorization: Session <token>`, as
the web app sends it). Events come newest first.

| Parameter | Meaning |
|---|---|
| `actor` | Actor name; `actorMatch=exact` (default) or `partial` (contains, case ignored). |
| `actorKind` | `human`, `agent` or `system`. |
| `action` | A code (`note.updated`) or a prefix ending in a dot (`note.`, `auth.`). |
| `outcome` | `success` or `failure`. |
| `targetKind`, `targetId` | The target's kind and id. |
| `from`, `to` | ISO 8601 with a time zone. `from` is inclusive, `to` exclusive. |
| `limit` | 1 to 200 (default 50). |
| `cursor` | `nextCursor` of the previous page. |

The answer is `{ events, nextCursor }`; `nextCursor` is `null` on the last page.
Pages are cut by time and id (keyset), so to look at a day, pass `from` and `to`
instead of paging there.

Examples (with the server on `localhost:3001` and a session token in `$S`):

```sh
# Everything an agent token called "claude-laptop" did on 4 October 2026 (UTC)
curl -H "Authorization: Session $S" \
  "http://localhost:3001/api/audit/v1/events?actor=claude-laptop&from=2026-10-04T00:00:00Z&to=2026-10-05T00:00:00Z"

# Failed sign-ins
curl -H "Authorization: Session $S" \
  "http://localhost:3001/api/audit/v1/events?action=auth.sign_in_failed"

# Every refused note write, then the next page
curl -H "Authorization: Session $S" \
  "http://localhost:3001/api/audit/v1/events?action=note.&outcome=failure&limit=100"
curl -H "Authorization: Session $S" \
  "http://localhost:3001/api/audit/v1/events?action=note.&outcome=failure&limit=100&cursor=<nextCursor>"

# What happened to one note
curl -H "Authorization: Session $S" \
  "http://localhost:3001/api/audit/v1/events?targetKind=note&targetId=<note id>"
```

One event, as returned:

```json
{
  "id": "01a105e6-ed20-738d-8cc4-fe1dcd0e481a",
  "occurredAt": "2026-10-04T07:16:03.207Z",
  "actor": { "kind": "agent", "name": "claude-laptop", "userId": null, "tokenId": "01a105c3-…" },
  "source": "mcp",
  "action": "note.updated",
  "outcome": "failure",
  "errorCode": "version_conflict",
  "target": null,
  "reason": "Merge the naming rules",
  "details": {
    "input": { "note": "Projects/Naming conventions", "expectedVersion": 1, "bodyCharacters": 1042 },
    "refusal": { "currentVersion": 2 }
  }
}
```

The contract is described in `apps/server/src/api/audit/v1/index.ts`; types in
`packages/shared/src/audit-api.ts`, the catalogue in
`packages/shared/src/audit-actions.ts`.
