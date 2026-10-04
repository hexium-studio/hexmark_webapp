# CI and releases

GitHub Actions run **only for `main`**. Pushes to `dev` start no workflow;
on `dev` the local `pre-push` hook and `pnpm test:all` do the checking (see
[tests/README.md](../tests/README.md)).

## Workflows

| File | Trigger | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | pull request targeting `main`, push to `main`, manual run | `checks` |
| `.github/workflows/release.yml` | push of a tag `v*` | `verify tag` → `checks (fast)` → `image (server\|web, amd64\|arm64)` → `manifest (server)`, `manifest (web)` → `GitHub release` |

**CI** (`checks`) runs `pnpm test:all`, the same command you run locally before
opening a pull request: lint, typecheck, `check:translations`, `check:docs`,
build, unit, integration and e2e tests, and a Docker build of both images (not
pushed). The list of checks lives only in `tools/run-checks.mjs`. It uploads nothing:
the job's console output names failed tests with their errors, and run logs
stay local ([tests/README.md, "CI artifacts"](../tests/README.md#ci-artifacts)). A new
push to a pull request cancels the run still going for it; runs on `main`
always finish.

**Release** does, in this order:

1. `verify tag` – the tag must look like `vX.Y.Z` or `vX.Y.Z-pre`, and the
   tagged commit must be on `main` (`git merge-base --is-ancestor`). Otherwise
   the run fails and nothing is published.
2. `checks (fast)` – `node tools/run-checks.mjs release`: lint, typecheck,
   `check:translations`, `check:docs`, unit tests. The commit already passed the full CI on
   its way into `main`; integration and e2e tests would cost minutes without
   new information, and the image builds compile everything again anyway.
3. `image (<image>, <arch>)` – four parallel legs, one per image (`server`,
   `web`) and platform, each on a **native runner** (no QEMU emulation):
   `linux/amd64` on `ubuntu-24.04`, `linux/arm64` on `ubuntu-24.04-arm`. Each
   leg builds one platform from the existing Dockerfile (build context =
   repository root), pushes it **by digest only** (no tag) and uploads the
   digest as the artifact `digests-<image>-<arch>`. OCI labels: title,
   description, source, license `Apache-2.0`. Layer cache in the GitHub
   Actions cache, one scope per image and architecture
   (`<image>-<arch>`).
4. `manifest (server)`, `manifest (web)` – combine the two platform digests
   into one multi-arch index (`docker buildx imagetools create`), with the
   OCI annotations on the index, and push it to
   `ghcr.io/hexium-studio/hexmark-server` and
   `ghcr.io/hexium-studio/hexmark-web` (owner taken from the repository, lower
   case). Tags: `X.Y.Z`, `X.Y` and `latest`; a pre-release `vX.Y.Z-rc.1` gets
   only `X.Y.Z-rc.1`. The job then inspects the index and fails unless both
   `linux/amd64` and `linux/arm64` are in it.
5. `GitHub release` – release "Hexmark X.Y.Z" with generated notes, marked as
   pre-release for `vX.Y.Z-pre`. Runs only after both `manifest` jobs.

The arm64 runners `ubuntu-24.04-arm` are free for public repositories. If the
repository were private, arm64 runners would need a paid plan (larger
runners); the `image (…, arm64)` legs would otherwise not start.

A release run takes roughly 10–20 minutes (estimate, not yet measured; mostly
the image legs, which run in parallel). Before, arm64 was built under QEMU
emulation, which was much slower (that job had a 90-minute timeout). Each
image leg now has a 45-minute timeout.

Third-party actions are pinned to commit SHAs with the version as a comment.
Dependabot (`.github/dependabot.yml`) opens a weekly pull request against `dev`
that updates them. npm dependencies are updated by hand for now.

## How to release

1. On `dev`: run `pnpm test:all` and push. The version comes from the git tag
   alone (the `version` fields in the `package.json` files stay `0.0.0`).
2. Open a pull request `dev` → `main`. Wait for `checks`, then merge it with
   a **merge commit** (not squash, not rebase), so `main` and `dev` keep the
   same commits.
3. Tag the merge commit on `main` with an annotated tag and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.1.0 -m "Hexmark 0.1.0"
   git push origin v0.1.0
   ```

4. Watch the Release run (roughly 10–20 minutes). If `verify tag` fails, the
   tag is not on `main`: delete it (`git push origin :refs/tags/v0.1.0`,
   `git tag -d v0.1.0`) and tag the right commit.

`compose.yaml` pulls `latest` unless `HEXMARK_VERSION` is set in `.env`.

## Repository settings (set by hand on GitHub)

The workflows depend on these settings; none of them is changed by a workflow.

- **Ruleset for `main`** (Settings → Rules → Rulesets, target: default branch
  or `main`):
  - Require a pull request before merging; allow merge commits.
  - Require status checks to pass: add **`checks`** (the job name in
    `ci.yml`; GitHub lists it once the workflow has run on a pull request).
    Also "require branches to be up to date" if wanted.
  - Require signed commits.
  - Block force pushes; restrict deletions.
- **Tags** (optional, recommended): a tag ruleset for `v*` that restricts
  creation, update and deletion to the maintainer.
- **Actions** (Settings → Actions → General):
  - Allow GitHub Actions; "Require actions to be pinned to a full-length
    commit SHA" can be enabled – all actions are pinned.
  - Workflow permissions: **Read repository contents** (the default). The
    workflows ask for `packages: write` and `contents: write` only in the jobs
    that need them.
  - Fork pull requests: require approval for outside contributors (pull
    requests are not accepted anyway, see CONTRIBUTING.md).
- **GHCR packages**: after the first release, open each package
  (`hexmark-server`, `hexmark-web`) → Package settings → change visibility to
  **public**, and check that the repository is linked with access for Actions
  (it is linked automatically through the `org.opencontainers.image.source`
  label).
- **Dependabot**: it reads `.github/dependabot.yml` from the default branch,
  so it starts once the file is on that branch.
