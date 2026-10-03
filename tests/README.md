# Tests

Every new feature ships with its tests. Three levels, all started from the
repository root:

| Level | Tool | What it covers | Command |
|---|---|---|---|
| `unit/` | Vitest | Pure logic: shared schemas and field error codes, setup token and locale rules, translation checks, Accept-Language matching, language picker order, the code input model, the toast store, the rate limiter | `pnpm test:unit` |
| `integration/` | Vitest + throwaway PostgreSQL 18 | The API server as a process: migrations, `/health`, setup status, token verification and rate limit, creating the first admin (incl. concurrency), instance locale, database check constraints | `pnpm test:integration` |
| `e2e/` | Playwright (Chromium) | The production build in a real browser: the whole setup wizard in English and German, language step, token cells, account validation, toasts and their timing, axe-core in light and dark, compositing layers (CDP `LayerTree`), no horizontal scrolling at 320 px | `pnpm test:e2e` |

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
  `POSTGRES_*` and `SETUP_TOKEN` (`support/hexmark-server.ts`): from source via
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

Only the toast timing tests (`e2e/toasts.spec.ts`) depend on the wall clock;
they allow generous margins (an error toast must close between 8.5 and 14 s).

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
