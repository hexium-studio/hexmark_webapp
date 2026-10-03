#!/usr/bin/env node
// Checks UI translations (see docs/translations.md). A translation is a
// catalogue in one of two forms: a <code>.json file, or a <code>/ folder with
// _meta.json and one <area>.json per area (packages/shared/src/translation-files.ts).
//
//   node tools/check-translations.mjs            strict check of the built-in
//                                                catalogues in apps/web/messages/
//   node tools/check-translations.mjs <path>...  report on your own catalogues:
//                                                a file, a catalogue folder, or
//                                                a folder holding catalogues;
//                                                --all lists every missing key
//
// Strict mode fails (exit 1) on anything that differs from English
// (apps/web/messages/en/); the root `pnpm build` runs it, so a broken built-in
// translation stops the build. Report mode explains what the web app will do
// with a catalogue when it is mounted as a custom translation: it exits 1
// only when the catalogue cannot be used at all (bad name, invalid JSON, no
// "_meta.name").
//
// Plain Node, no build step: the rules come from packages/shared (loaded as
// TypeScript through Node's type stripping), the same code the web app uses
// to load custom translations.

import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogueEntry,
  isFolder,
  META_FILE,
  readCatalogueFolder,
} from "../packages/shared/src/translation-files.ts";
import { checkFile } from "./translations/check-file.mjs";
import { printResult } from "./translations/print.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const builtInDir = join(repoRoot, "apps/web/messages");

function fail(message) {
  console.error(`check-translations: ${message}`);
  process.exit(1);
}

function visibleEntries(dir) {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort();
}

// English is the reference for every check, in both modes.
const english = readCatalogueFolder(join(builtInDir, "en"));
if (!english.data) fail(`cannot read apps/web/messages/en/: ${english.error}`);
const reference = { ...english.data };
delete reference._meta;

const builtInCodes = new Set(
  visibleEntries(builtInDir)
    .map((name) => catalogueEntry(name, isFolder(join(builtInDir, name))))
    .filter((entry) => entry?.form === "folder")
    .map((entry) => entry.code),
);

// A folder is one catalogue when it is named like one or holds _meta.json;
// otherwise it holds catalogues.
function isCatalogueFolder(path) {
  return catalogueEntry(basename(path), true) !== undefined || existsSync(join(path, META_FILE));
}

// Catalogues in a folder of catalogues. Where <code>.json and <code>/ both
// exist, both are checked and the file is marked as ignored by the app.
function catalogueTargets(dir, arg) {
  const targets = [];
  const ignored = [];
  const names = visibleEntries(dir);
  for (const name of names) {
    const path = join(dir, name);
    const entry = catalogueEntry(name, isFolder(path));
    if (!entry && !name.endsWith(".json")) {
      ignored.push(name);
      continue;
    }
    const shadowedBy =
      entry?.form === "file" && names.includes(entry.code) && isFolder(join(dir, entry.code))
        ? `${entry.code}/`
        : undefined;
    targets.push({ path, shadowedBy });
  }
  if (ignored.length > 0) console.log(`${arg}: ignoring ${ignored.join(", ")} (no catalogue)\n`);
  return targets;
}

function collectTargets(args) {
  const targets = [];
  for (const arg of args) {
    const path = resolve(arg);
    if (!existsSync(path)) fail(`${arg}: no such file or folder`);
    if (!isFolder(path) || isCatalogueFolder(path)) targets.push({ path });
    else targets.push(...catalogueTargets(path, arg));
  }
  return targets;
}

const options = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("-")));
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (options.has("--help") || options.has("-h")) {
  console.log("Usage: node tools/check-translations.mjs [--all] [file-or-folder ...]");
  process.exit(0);
}
const unknownOption = [...options].find((option) => option !== "--all");
if (unknownOption) fail(`unknown option ${unknownOption} (try --help)`);
const mode = args.length === 0 ? "strict" : "report";
const strict = mode === "strict";
const targets = strict
  ? visibleEntries(builtInDir).map((name) => ({ path: join(builtInDir, name) }))
  : collectTargets(args);
if (targets.length === 0) fail("no translations to check");

// Relative to the working directory when below it, else absolute; folders end in "/".
function displayPath(path) {
  const shown = relative(process.cwd(), path);
  const display = shown === "" || shown.startsWith("..") ? path : shown;
  return isFolder(path) ? `${display}/` : display;
}

let failed = 0;
for (const { path, shadowedBy } of targets) {
  const result = checkFile(path, { mode, reference, builtInCodes, shadowedBy });
  printResult(displayPath(path), result, { all: strict || options.has("--all") });
  if (result.failed) failed += 1;
}

const what = strict ? "built-in translation" : "translation";
const total = `${targets.length} ${what}${targets.length === 1 ? "" : "s"} checked`;
if (failed === 0) {
  console.log(`${total}, all ${strict ? "passed" : "usable"}.`);
} else {
  console.log(`${total}, ${failed} ${strict ? "with errors" : "not usable"}.`);
  process.exitCode = 1;
}
