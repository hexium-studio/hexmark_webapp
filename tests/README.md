# Tests

Every new feature ships with its tests. Three levels, all started from the
repository root:

| Level | Tool | What it covers | Command |
|---|---|---|---|
| `unit/` | Vitest | Pure logic: shared schemas and field error codes, the UUID version 7 generator (layout, order within one millisecond and with the clock going backwards, uniqueness) and the start-up refusal of PostgreSQL older than 18, setup token and locale rules, translation checks, Accept-Language matching, the order of the language sources, language picker order, the code input model, the toast store, the rate limiter, session cookie options and the proxy's session header, the sign-in form check, role labels, instance keys and encryption at rest, client addresses (IP/CIDR matching, X-Forwarded-For walking, which headers are trusted), TOTP against the RFC 6238/4226 test vectors (window, replay), recovery code format, normalisation and keyed digest, challenge and re-authentication rules, time zone validation, `PUBLIC_ORIGIN` parsing; the notes core: the Markdown section parser (ATX and Setext headings, code blocks and HTML, skipped levels, repeated headings, CRLF, offsets and sizes with emoji and umlauts), finding sections (exact path, then the end of a path in whole headings, repeated headings as ambiguous) and replacing them, reading a section in pieces cut at line breaks (past the end with the offset as requested), the refusal of a section not found once with the section as requested, the shortened section path of a revision, search snippets ("…" where cut off, sentence punctuation kept, phrases as one mark, ranks relative to the best hit), the blank line replacing a section adds before the next heading, the note for reading past the end, the trash retention (`TRASH_RETENTION_DAYS`, purged on day 29, cutoff and due agree), invalid MCP arguments as `invalid_input` with a rule per field, note addresses, the access evaluation (`access-policy.test.ts`: allow and deny lists × folders and single notes × nested at any depth × the owner's role, a listed note found by search, the folders granting a permission), the lock an item is under (its own, else the nearest locked folder above, the holder's id hidden when out of reach), hidden folders in the access evaluation (`hidden-policy.test.ts`: a session, an allow list and a deny list × an item not hidden, the hidden folder itself, directly in it and deeper × entries allowing or excluding it; not found, `folder_not_found` for a place below it, the hidden folder left to the write guard, the hidden set of the locked rows deciding), the hidden mark an item is under and the refusal `hidden` alone, with `locked: null` and with the lock of the same write (`hidden-state.test.ts`), the diff of a changed token (added, removed and changed entries, a new mode replacing all), the role check of a token's permissions, the API token format, `SECTION_TOKEN_BUDGET` and `MCP_PUBLIC_URL`, and the shared note, token and MCP input schemas (a token's mode required, the rules that depend on it); the audit log: the sanitizer (secret-looking fields dropped at any depth, texts and lists shortened, the size cap with the largest fields dropped first, deterministically; failures with known input fields only and field codes without rules), the action catalogue (codes the table accepts, an action of the catalogue for every MCP tool), the query string, the cursor, `AUDIT_RETENTION_DAYS` and the purge cutoff, the items list of a folder batch (sorted, cut by count and size below the details limit, the same for the same items, `itemsTruncated` and `itemsTotal`), the throttle of rejected token events (once per key and window, the count left out reported after it, at most `maxKeys` keys); snippets at the end of a short section and hyphenated words, the marks of a hyphenated query word's parts taken off elsewhere (unless the query has the part as a word of its own); in the web app the login answers with a second step, the challenge cookie and the session held during forced enrolment, second-factor refusals and overviews, the QR code drawing, the recovery codes file, the time zone list (with UTC, grouped by region), the factor rules shared with the server, and for the token page the MCP address without `MCP_PUBLIC_URL` (https only behind a trusted proxy), the permissions offered per role and kind of target, the target tree (filled in when a folder is opened), the access a form sends and what is missing before, tokens with their entries and refusals as read, and the locked and hidden items lists; the run logs (`support/run-log-*.test.ts`: escape sequences stripped, also when cut between two chunks, characters cut between buffers, run directory names, a second run in the same second, pruning the oldest runs and nothing else, the failed tests read from Vitest's and Playwright's reports, `summary.json` without anything from the environment); the test processes and their ports (`support/ports.test.ts`, `support/processes.test.ts`: two listeners on one port clashing, a dead-end port, the forwarder following its target, output lines cut between chunks, waiting for a line until the process exits or time runs out) and `PORT=0` for the API server (`server/server-port.test.ts`) | `pnpm test:unit` |
| `integration/` | Vitest + throwaway PostgreSQL 18 | The API server as a process: migrations, `/health`, setup status, token verification and rate limit, creating the first admin (incl. concurrency), instance locale, database check constraints, sign-in and sessions, the web server's session check (`fetchMe`), forwarded client addresses (trusted only with `INTERNAL_API_KEY`) and refusals without valid instance keys; second factors: sign-in with authenticator app, recovery code and security key (software authenticator, `support/soft-authenticator.ts`), challenge expiry, attempt and address limits, forced enrolment, the setup ticket and system settings, the account endpoints with re-authentication, the last-factor rule under concurrent removals, and what deleting a user removes; the notes tables (folders, notes, revisions incl. the section path of section-level edits, sections, API tokens): their check constraints both ways, upgrades from the previous migration with existing rows kept unchanged, the generated search column against real queries, unique names and titles that ignore the trash, and what deleting users, tokens and notes keeps or removes; the notes API (`/api/notes/v1`): every endpoint with the rows it writes, versions and `version_conflict` (also for sections, with the current section text), revisions with the username or the token's name, folders (cycles, only empty ones deleted), the trash, search per section with snippets, changes since a time, guests, token permissions intersected with the owner's role, folder scope with subfolders (now allow lists), revoked and expired tokens, `last_used_at`, racing writes; the token API (`/api/tokens/v1`, shown once with the `mcpServers` block, digest only stored, session only, creating only with the password re-entered in the last 10 minutes, revoking without; a mode required and every rule that depends on it, entries stored with their paths and the trash flag, the legacy columns left empty; `api-tokens-update.test.ts`: changing entries, permissions, base set and expiry with the rows before and after, a new mode replacing all entries in one go, the exact diff in `token.updated`, refusals without a recent password, for other users and for bad access, an entry kept while its target is in the trash but no new one there, the new access applying to the next request); access lists everywhere (`access-allow-list.test.ts`, `access-deny-list.test.ts`, over HTTP and MCP: tree, reads, search, titles and ambiguous candidates, changes, revisions, the trash, the overview, per-entry permissions, nothing at the root level of an allow list, new content in a deny list, a folder with excluded content not deleted); entries of targets deleted for good removed and logged as `token.entry_removed` by System, by a person and by the purge (`token-entry-removal.test.ts`); tokens from before migration 0010 working through the new evaluation (`migration-0010-tokens-work.test.ts`); locks (`locks-api.test.ts`, `mcp-locks.test.ts`: locking with the lock permission and a reason, every write of an agent refused with `locked` and nothing written while people may write, a folder's lock covering what is created later, lock state in reads and the tree, a folder with a locked note not deleted and a batch with one not restored, unlocking for people only, the list of locked items, every attempt in the audit log); hidden items (`hidden-reads.test.ts`, `hidden-writes.test.ts`, `hidden-races.test.ts`, `hidden-audit.test.ts`, wiki in `hidden-harness.ts`: every agent read path - search for a secret word in a hidden note's body and heading and below a hidden folder with zero hits while people find all three, a hidden note found by its title only, its content refused with `hidden`, revisions and changes without the section path, the hidden folder without counts and not listable, nothing below it by id, title or path, not among ambiguous candidates, not in the trash, not in an allow list's entries - with every answer scanned for the secret and the names below; every agent write on, into or taking along a hidden item refused with `hidden` before the version check and the rows unchanged, below a hidden folder `folder_not_found`, people writing as usual; hidden and locked together answering `hidden` with the lock in `locked`, unhiding keeping a real lock, unlocking then freeing the write; hiding by an agent with a reason (the row with the token as actor, `changed: false` the second time), unhiding for people only and only with the password re-entered recently, the list of hidden items for people only; racing writes against a folder or note hidden meanwhile; every success and failure in the audit log without the content); the MCP server through the official SDK client over Streamable HTTP: instructions, the guide resource, the tool list (25 tools, `hide_note` and `hide_folder` with a required reason and no unhide tool; names, titles, descriptions, annotations and input schemas equal to `MCP_TOOLS`, the definitions `docs/mcp.md` is generated from), every tool once successfully and once refused, invalid arguments of every kind as `invalid_input` with nothing written, repeated headings and path ends, long sections read in pieces, paths in write answers, `title_taken` naming the holder, `lastChange` with a conflict, folders not loaded with their counts, the section path of revisions (stored and shown in history and changes), a version conflict and a token revoked while connected, the trash tools (each with the rows it writes, `in_trash`, a token without `delete`, no tool that deletes for good, `restore_note` under another title with the `title_taken` text pointing there, where `list_trash` entries were as `parentId`/`parentPath`), `rename_folder` (permission `edit`) and `move_folder` (permission `move`) with the folder rows before and after (taken names, cycles, the root level, folder scope with the parent outside it not named), `folder_in_trash` from every folder tool for a folder in the trash (and `folder_not_found` for a token that cannot see where it was), nothing written and the answers the agent test asked for (heading as written and snippet apart, punctuation, phrases, relative ranks, `characters`, `updatedBy`/`lastChange` in listings, the added blank line, reading past the end with the offset as requested, `ambiguous_section` repeating the section, the message of a write that changed nothing); the trash over HTTP: notes and folders into it (a folder with its subtree as one batch, items deleted earlier keeping theirs, a `deleted` revision per note with actor and reason), listing with original paths, counts and the server's retention, restoring (the batch, `parent_in_trash`, another folder or the root level, titles and names taken meanwhile, another title), `folder_in_trash` on every endpoint that takes a folder in use (409 with deletedAt, purgeAt, batchId, nothing written; outside a token's folders 404), folder scope (also `parentId`/`parentPath` of an entry whose parent lies outside), deleting for good (sessions only: API tokens get 403; emptying for admins only; only with the password re-entered in the last 10 minutes, refused without or too long ago with nothing removed, and working once re-entered) with revisions and sections going along, races with creating, restoring and moving, and the retry after a deadlock; the purge called in the test process with a chosen clock (exactly what is due, children before parents, cascades, the day-29 boundary, the advisory lock against a second purge) and run by the server at start (counts in the log, `TRASH_RETENTION_DAYS`, an invalid value); for the HTTP API also blank (`empty`) versus missing (`required`) fields; UUID version 7 ids: migration 0008 on rows in every table (all values and version 4 ids unchanged, defaults `uuidv7()`, new rows version 7 also when they point at old rows), its PostgreSQL version check both ways, and the ids the running server creates (incl. trash batches) next to rows with version 4 ids; the audit log table of migration 0009: every check both ways (actor kind and ids, "System", dotted action codes, error code exactly on failure, target pairing, reason, details as an object up to 16 KB, no IP column), the indexes for the log filters, append-only (UPDATE, DELETE and TRUNCATE refused, also from inside another trigger; DELETE and TRUNCATE allowed with `set local hexmark.audit_purge = 'on'` and only in that transaction), deleting a user or token setting its id to null and keeping the row and name, the test reset clearing it, and the upgrade from 0008 with every existing row unchanged; what the server writes to the audit log (`audit-*.test.ts`, helpers in `audit-log-harness.ts`): every note, folder and trash action once with actor, source (`web`, `http`, `mcp`, `system`), target and reason, refused writes leaving nothing but their failure (error code, input summarized, no body), an action rolled back when its event cannot be written, an agent's reads logged over HTTP and MCP and a person's never, refused reads and invalid input, deleting for good and the purge per item with one `runId`, sign-in (method, a wrong password for the account, an unknown e-mail as "unknown", the rate limit), sign-out, an expired session not logged, re-entering the password, API tokens (created, revoked, rejected: revoked by name, unknown as "invalid token"), second factors (added only when confirmed, removed, renamed keys, new and used recovery codes, right and wrong answers at sign-in), the setup wizard (admin, factor, settings with old and new values) and forced enrolment, the audit purge with a chosen clock (cutoff, `audit.purged` with the count, the advisory lock, still append-only afterwards) and `AUDIT_RETENTION_DAYS` at server start, the query API (sessions only, a token's attempt logged, administrators everything, others their own and their tokens', every filter, from inclusive and to exclusive, the cursor through equal timestamps, invalid filters, the catalogue); every audit test file scans all events of its database for the passwords, tokens, codes, secrets, e-mails and note bodies it used; folder batches (`audit-folder-batches.test.ts`, `audit-purge-batches.test.ts`: the folder's event listing every subfolder and note with id and path, one event per item with `viaFolder`, a note's batch deletion and restore found by filtering on its id, deleting for good and the purge listed the same way, a large batch cut below the size limit with every item still logged); rejected tokens logged once per value however often and by whichever way they are sent, a working token unaffected (`audit-token-throttle.test.ts`); the answers the fourth agent test asked for (`mcp-run4.test.ts`: snippets that keep an emoji and the final period or a code fence, hyphenated words marked as one, `name_taken` naming the holder, `notice`, `in_trash` with batch and path, `restore_folder` counts) and the fifth (`mcp-run5.test.ts`, `mcp-run5-folders.test.ts`: `restoredSubfolders`, `folder_in_trash` and `in_trash` with the folder, its path and the batch's folder, a hyphenated word marked without its parts elsewhere, `read_revision` with `noteId`, `create_folder` with a reason in the log, `folder_cycle` naming both folders, over MCP and HTTP) and of the agent test of access lists, locks and hidden items (`access-answers.test.ts`: no id of a folder out of reach in any answer about a note listed on its own - reads, search, history, overview, listings, writes, HTTP - while reachable ones stay, `existingFolderId`/`existingNoteId` null for an excluded holder; the root level of an allow list `outside_scope` for creating (also holding `create` nowhere), moving and restoring, a reachable folder without the permission naming it; `mcp-marks-answers.test.ts`: `delete_folder` and `restore_folder` with a hidden note (`hidden`, naming it), a note out of reach (`hidden_content`, naming nothing) and both (`hidden`), the rows unchanged; `list_changes` with the `locked` and `hidden` objects of every read; locking inside a locked folder `locked` with `alreadyLocked`, locking or hiding again `changed: false` with a message) | `pnpm test:integration` |
| `e2e/` | Playwright (Chromium) | The production build in a real browser: the whole setup wizard in English and German, language step, token cells, account validation, toasts and their timing; sign-in, home and sign-out at `/` with the session cookie (remember me, rotation, idle timeout, blocked state) and the locale cookie set on sign-in, password reveal buttons; axe-core in light and dark, compositing layers (CDP `LayerTree`), no horizontal scrolling at 320 px and (sign-in) with 200 % text; client addresses behind a trusted proxy (separate lockouts, forged headers ignored, Secure cookie) and the missing-keys check; second factors: setup steps 5 and 6 (authenticator app with codes computed from the shown key, a security key through Chrome's virtual authenticator, recovery codes, system settings, skipping, an expired setup ticket), sign-in with the app, a recovery code (once) and a security key, wrong codes, an expired challenge, forced enrolment, the account security page (adding, renaming, removing with the password in a dialog, new codes, a larger set of codes issued earlier, the last-factor rule), and for these pages axe, overflow, layers and messages that move nothing; the API token page (`/account/tokens`): creating a token with the password confirmed in a dialog, the one-time `mcpServers` block (copied as JSON only, gone after a reload, with the address built from the host and `SERVER_PORT`), connecting with it through the MCP SDK client, the access mode chosen explicitly (none preset), folders and notes picked in the tree at any depth with permissions per entry, changing a token's access (`token-edit.spec.ts`: switching the mode, picking a deep note, saving with the password confirmed, the token's new access in effect), the `delete` and `lock` permissions offered, a taken name at the field, a guest's permissions, revoking (the token gets 401 at once), axe, overflow at 320 px and layers in every state (also the opened tree and the change form); the locked items page (`locked.spec.ts`: what an agent locked with who and why, unlocking, the agent able to write again, axe) and its hidden items (`hidden.spec.ts`: what an agent and a person hid with who and why, what a folder covers, axe, unhiding in a dialog that names the item, a wrong password at the field with nothing changed, then the right one, the agent able to read again, a second unhide without the password within 10 minutes); the page title is never missing while server actions render the page again (forced enrolment, sign-in). WebAuthn tests open the web app at `http://localhost:<port>` with the API server's `PUBLIC_ORIGIN` set to it | `pnpm test:e2e` |

More commands:

- `pnpm test` – unit and integration tests.
- `pnpm test:all` – exactly what CI runs before a merge to `main`: lint,
  typecheck, `check:translations`, `check:docs`, build, unit, integration, e2e,
  and a Docker build of both images (not exported, not pushed). Stops at the first failure
  and prints a summary with the time of each step, the failed tests and where
  the logs are ([Run logs](#run-logs)). Run it before opening a pull request to
  `main`.
- A single file or test: `pnpm test:unit tests/unit/web/code-model.test.ts`,
  `pnpm exec playwright test --config tests/e2e/playwright.config.ts token -g "wrong token"`
  (the latter needs a current `pnpm build`).

## Requirements

- **Docker running** for integration and e2e tests (and the Docker build in
  `test:all`). The image `postgres:18-alpine` is pulled on first use.
- **Playwright's Chromium** for e2e tests, once per Playwright version:
  `pnpm exec playwright install chromium`.
- Nothing else: no `.env`, no running Hexmark stack. The tests ignore the
  repository's `.env` and the custom translations in `locales/`.

## Throwaway infrastructure

The tests never touch the development stack from `compose.dev.yaml` (ports
3000/3001/5432, its database volume).

- **PostgreSQL**: one `postgres:18-alpine` container per test run
  (`support/postgres-container.ts`), on a random free port of 127.0.0.1, data in
  a tmpfs (no volume), labelled `hexmark.tests`. Removed when the run ends.
- **Databases**: each integration test file and each e2e worker creates its own
  database in that container and drops it afterwards.
- **API server**: started as a separate process on a port the operating
  system picks ([Ports](#ports)) with its own
  `POSTGRES_*`, `SETUP_TOKEN` and fixed test instance keys
  (`INTERNAL_API_KEY`, `ENCRYPTION_KEY`; `support/hexmark-server.ts`): from source via
  tsx for integration tests, the production bundle (`apps/server/dist`) for e2e
  tests. Each process has its own in-memory rate limiter, so starting a fresh
  one resets the attempt counters.
- **Web app** (e2e only): the standalone production build
  (`apps/web/.next/standalone`), as the Docker image runs it, pointing at its
  worker's API server, with an empty custom translations folder.

### Ports

Two processes of the same run must never get the same port; the tests run in
parallel, so a port that was free a moment ago can be taken by the time a
process binds it. The rules (`support/ports.ts`):

- **The operating system picks the port while binding** (port 0) wherever
  possible: the API server is started with `PORT=0` and reports the port in
  its start-up line (`Hexmark server listening on port <n>`), which
  `support/hexmark-server.ts` reads. Nothing can take that port in between.
- **Every listener binds `::`** (IPv6 and IPv4). With different addresses
  (`::` and `127.0.0.1`) macOS lets two processes bind one port and sends
  local IPv4 connections to the more specific one, a silent mix-up instead of
  an error.
- **The web server** (Next.js's standalone server reads `PORT=0` as "unset")
  gets a port that was free on `::` a moment before; if another process took
  it, the server exits with `EADDRINUSE` and is started again on a new port
  (up to 5 times, `support/web-server.ts`).
- **No port is given up and bound again.** An e2e worker's API server is
  restarted before every test on a new port; a forwarder held by the worker
  keeps one address for it (`serverUrl`, `SERVER_INTERNAL_URL` and
  `SERVER_PORT` of the web server point there).
- **A port where nothing answers** (a database that cannot be reached) is a
  port the test holds and that closes every connection (`unreachablePort()`
  in `integration/harness.ts`), not one that is merely free.

The PostgreSQL container's port is chosen by Docker
(`--publish 127.0.0.1::5432`) before any server starts.

Clean-up: global setup/teardown and fixtures stop everything after a run, also
after failures. As a safety net every process runs under `support/guard.mjs`,
which stops it (and removes the container) as soon as the test process that
started it is gone, e.g. after Ctrl+C or a crash. A container left behind by a
run that was killed outright is removed at the start of the next run. Check
with `docker ps --filter label=hexmark.tests`.

Logs of the started servers and Playwright's traces and screenshots of failed
tests go to the run's directory in `tests/.artifacts/runs/` (ignored by git;
[Run logs](#run-logs)).

## Parallel runs and shared state

- **Unit**: no shared state; files run in parallel. Module state (the toast
  store) is re-imported per test.
- **Integration**: files run in parallel, each with its own database and
  server(s); tests inside a file run one after another and may share the
  file's database. Tests that count rate-limit attempts start their own server.
- **E2E**: tests run in parallel on up to 3 workers (2 in CI). Each worker has
  its own database, API server and web server; before every test the worker's
  database is reset to "setup not done" and its API server is restarted, so no
  test depends on another one.

The toast timing tests (`e2e/toasts.spec.ts`) depend on the wall clock;
they allow generous margins (an error toast must close between 8.5 and 14 s).
Authenticator app codes in the integration tests are computed from the wall
clock like a real app; a test waits at most 2 s when a 30-second step is
about to end (`awayFromStepEdge`), and nothing slow (a sign-in with its
password hashing) runs between computing a code that depends on the exact
step (one step back, two steps ahead) and sending it. Expiry and re-authentication windows are
tested by moving timestamps in the database, never by waiting.

## No retries

Playwright runs with `retries: 0`, locally and in CI: a test that fails once
fails the run. A retry would turn a race in the app or in a test into a
"flaky" pass that nobody looks at; a failure is investigated instead (trace,
screenshot and server logs in the run directory, [Run logs](#run-logs)). To check a test for
flakiness, repeat it:
`pnpm exec playwright test --config tests/e2e/playwright.config.ts <file> --repeat-each=30`.

## Run logs

Every test run leaves a directory in `tests/.artifacts/runs/`, named after its
start in UTC and what ran: `2026-10-04T09-15-02Z-pre-push` for
`node tools/run-checks.mjs pre-push` (also the git hook and `pnpm test:all`,
profile `all`), `…-test-unit`, `…-test-integration`, `…-test` (both projects)
or `…-test-e2e` for a suite started on its own (`pnpm test:unit`,
`pnpm test:integration`, `pnpm test`, `pnpm test:e2e` or `pnpm exec playwright
test …`). Run logs are written locally only: the test configs and
`tools/run-checks.mjs` write them to this folder and send them nowhere, and like
everything in `tests/.artifacts/` they are ignored by git.

| File | Content |
|---|---|
| `<step>.log` | The step's whole console output (stdout and stderr) as plain text, colours removed; also for a passing step. Steps are named as in `tools/run-checks.mjs` with `:` as `-` (`test-integration.log`). A suite on its own writes one log named like its directory (`test-unit.log`); for `pnpm test:e2e` the build before it is not in it. |
| `<step>.report.json` | Every test case of a Vitest step (Vitest's `json` reporter: `testResults[].assertionResults[]` with `fullName`, `status`, `duration` in ms and, on failure, `failureMessages` with message and stack) or of Playwright (its `json` reporter: `suites[].specs[].tests[].results[]` with `status`, `duration`, `errors` with message and stack, the test's `stdout`/`stderr`). |
| `summary.json` | Only from `tools/run-checks.mjs`: profile, `status`, `startedAt`/`endedAt` (UTC), `durationMs`, `git` (`branch`, `commit`, `dirty` for uncommitted changes) and every step of the profile with `status` (`pass`, `fail`, `skip`), `exitCode`, `durationMs`, its log and report files, the test counts and, for a failed test step, `failedTests` (`<file> > <describe> > <test>`) and `errors` (failures outside a test, e.g. a file that does not load or a failing global setup). No environment variables. |
| `servers/` | Logs of the PostgreSQL containers, API servers and web servers the tests started. |
| `e2e-results/` | Playwright's traces and screenshots of failed tests. |

Finding a failed test: the console summary of `tools/run-checks.mjs` names the
failed tests and the run directory. Afterwards, the newest directory with a
failure is found with `grep -l '"status": "fail"'
tests/.artifacts/runs/*/summary.json`; `failedTests` in it names the tests, the
step's `.report.json` has message and stack, the step's `.log` shows the output
around it, and `servers/` what the servers did meanwhile. A trace opens with
`pnpm exec playwright show-trace <run>/e2e-results/<test>/trace.zip`.

Retention: the newest 50 run directories are kept; whenever a run starts, older
ones are removed (`RUNS_KEPT` in `support/run-log/run-dir.ts`). Other files in
`tests/.artifacts/runs/` are left alone. The code is in `support/run-log/`;
the test configs and `tools/run-checks.mjs` pass the run directory to
everything below them in `HEXMARK_TEST_RUN_DIR` (and the step in
`HEXMARK_TEST_STEP`).

## Git hook (pre-push)

`pnpm install` installs a `pre-push` hook (`simple-git-hooks`, configured in the
root `package.json`, installed by the `prepare` script). Before every push it
runs `node tools/run-checks.mjs pre-push`: lint, typecheck,
`check:translations`, `check:docs`, unit and integration tests (about half a
minute; needs Docker). A failure aborts the push.

- Bypass once: `git push --no-verify`.
- Skip the hook for a shell session: `SKIP_SIMPLE_GIT_HOOKS=1 git push`.
- After changing the hook in `package.json`: `pnpm exec simple-git-hooks`.

The e2e tests and the Docker builds are not part of the hook; CI runs them
on pull requests to `main`, and `pnpm test:all` runs them locally.

## CI

GitHub Actions run only for `main`: the job `checks` in
`.github/workflows/ci.yml` runs `pnpm test:all` on every pull request to
`main` and every push to `main`, and is required for merging. Releases
(`release.yml`) run only the fast part (`node tools/run-checks.mjs release`:
lint, typecheck, `check:translations`, `check:docs`, unit). Details, the release steps and
the repository settings: [docs/releasing.md](../docs/releasing.md).

## CI artifacts

CI uploads nothing from a test run: run directories ([Run logs](#run-logs))
stay on the machine that ran the checks. When `checks` fails on GitHub, the
job's console output names the failed tests with their errors (the summary
printed by `tools/run-checks.mjs`); to dig deeper, run the failing step
locally and read its run directory.
