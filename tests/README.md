# Tests

Every new feature ships with its tests. Three levels, all started from the
repository root:

| Level | Tool | What it covers | Command |
|---|---|---|---|
| `unit/` | Vitest | Pure logic: shared schemas and field error codes, setup token and locale rules, translation checks, Accept-Language matching, the order of the language sources, language picker order, the code input model, the toast store, the rate limiter, session cookie options and the proxy's session header, the sign-in form check, role labels, instance keys and encryption at rest, client addresses (IP/CIDR matching, X-Forwarded-For walking, which headers are trusted), TOTP against the RFC 6238/4226 test vectors (window, replay), recovery code format, normalisation and keyed digest, challenge and re-authentication rules, time zone validation, `PUBLIC_ORIGIN` parsing; in the web app the login answers with a second step, the challenge cookie and the session held during forced enrolment, second-factor refusals and overviews, the QR code drawing, the recovery codes file, the time zone list (with UTC, grouped by region) and the factor rules shared with the server | `pnpm test:unit` |
| `integration/` | Vitest + throwaway PostgreSQL 18 | The API server as a process: migrations, `/health`, setup status, token verification and rate limit, creating the first admin (incl. concurrency), instance locale, database check constraints, sign-in and sessions, the web server's session check (`fetchMe`), forwarded client addresses (trusted only with `INTERNAL_API_KEY`) and refusals without valid instance keys; second factors: sign-in with authenticator app, recovery code and security key (software authenticator, `support/soft-authenticator.ts`), challenge expiry, attempt and address limits, forced enrolment, the setup ticket and system settings, the account endpoints with re-authentication, the last-factor rule under concurrent removals, and what deleting a user removes | `pnpm test:integration` |
| `e2e/` | Playwright (Chromium) | The production build in a real browser: the whole setup wizard in English and German, language step, token cells, account validation, toasts and their timing; sign-in, home and sign-out at `/` with the session cookie (remember me, rotation, idle timeout, blocked state) and the locale cookie set on sign-in, password reveal buttons; axe-core in light and dark, compositing layers (CDP `LayerTree`), no horizontal scrolling at 320 px and (sign-in) with 200 % text; client addresses behind a trusted proxy (separate lockouts, forged headers ignored, Secure cookie) and the missing-keys check; second factors: setup steps 5 and 6 (authenticator app with codes computed from the shown key, a security key through Chrome's virtual authenticator, recovery codes, system settings, skipping, an expired setup ticket), sign-in with the app, a recovery code (once) and a security key, wrong codes, an expired challenge, forced enrolment, the account security page (adding, renaming, removing with the password in a dialog, new codes, a larger set of codes issued earlier, the last-factor rule), and for these pages axe, overflow, layers and messages that move nothing; the page title is never missing while server actions render the page again (forced enrolment, sign-in). WebAuthn tests open the web app at `http://localhost:<port>` with the API server's `PUBLIC_ORIGIN` set to it | `pnpm test:e2e` |

More commands:

- `pnpm test` – unit and integration tests.
- `pnpm test:all` – exactly what CI runs before a merge to `main`: lint,
  typecheck, `check:translations`, build, unit, integration, e2e, and a Docker
  build of both images (not exported, not pushed). Stops at the first failure
  and prints a summary with the time of each step. Run it before opening a pull
  request to `main`.
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
- **API server**: started as a separate process on a free port with its own
  `POSTGRES_*`, `SETUP_TOKEN` and fixed test instance keys
  (`INTERNAL_API_KEY`, `ENCRYPTION_KEY`; `support/hexmark-server.ts`): from source via
  tsx for integration tests, the production bundle (`apps/server/dist`) for e2e
  tests. Each process has its own in-memory rate limiter, so starting a fresh
  one resets the attempt counters.
- **Web app** (e2e only): the standalone production build
  (`apps/web/.next/standalone`), as the Docker image runs it, pointing at its
  worker's API server, with an empty custom translations folder.

Clean-up: global setup/teardown and fixtures stop everything after a run, also
after failures. As a safety net every process runs under `support/guard.mjs`,
which stops it (and removes the container) as soon as the test process that
started it is gone, e.g. after Ctrl+C or a crash. A container left behind by a
run that was killed outright is removed at the start of the next run. Check
with `docker ps --filter label=hexmark.tests`.

Logs of the started servers and Playwright's traces and screenshots of failed
tests go to `tests/.artifacts/` (ignored by git).

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
screenshot and server logs in `tests/.artifacts/`). To check a test for
flakiness, repeat it:
`pnpm exec playwright test --config tests/e2e/playwright.config.ts <file> --repeat-each=30`.

## Git hook (pre-push)

`pnpm install` installs a `pre-push` hook (`simple-git-hooks`, configured in the
root `package.json`, installed by the `prepare` script). Before every push it
runs `node tools/run-checks.mjs pre-push`: lint, typecheck,
`check:translations`, unit and integration tests (about half a minute; needs
Docker). A failure aborts the push.

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
lint, typecheck, `check:translations`, unit). Details, the release steps and
the repository settings: [docs/releasing.md](../docs/releasing.md).
