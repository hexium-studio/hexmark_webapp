import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_PATTERN } from "./locale-pattern.ts";
import { isMessageTree, type MessageTree } from "./translation-check.ts";

// Reads a translation catalogue from disk in either of its two forms:
//   file    <code>.json   the whole catalogue: "_meta" plus one key per area
//   folder  <code>/       _meta.json plus one <area>.json per area, each
//                         holding what the file form has under that area key
// Both become the same tree, so translation-check.ts and the web app's
// catalogue never see the difference. Built-in catalogues use the folder
// form (apps/web/messages/<code>/); custom ones may use either.
// Used by tools/check-translations.mjs and the web app's locale registry
// (server code only: it reads files). Relative imports carry the .ts
// extension for the tool's plain Node (see translation-check.ts).

export const META_FILE = "_meta.json";
const JSON_SUFFIX = ".json";

export type CatalogueForm = "file" | "folder";

export interface CatalogueEntry {
  code: string;
  form: CatalogueForm;
  // Entry name in its parent folder: "ru.json" or "ru".
  name: string;
}

// The catalogue an entry of a translations folder stands for, if any: a
// <code>.json file or a <code> folder. Anything else is not a catalogue.
export function catalogueEntry(name: string, isFolder: boolean): CatalogueEntry | undefined {
  const code = isFolder
    ? name
    : name.endsWith(JSON_SUFFIX)
      ? name.slice(0, -JSON_SUFFIX.length)
      : "";
  if (!LOCALE_PATTERN.test(code)) return undefined;
  return { code, form: isFolder ? "folder" : "file", name };
}

export interface SkippedFile {
  // Area file name inside the folder, e.g. "setup.json".
  file: string;
  reason: string;
}

export interface CatalogueRead {
  // The assembled catalogue; undefined when it cannot be used at all.
  data?: MessageTree;
  // Why `data` is missing.
  error?: string;
  // Folder form: area files that could not be read. Their messages count as
  // missing; the rest of the catalogue stays usable.
  skipped: SkippedFile[];
  // Folder form: entries that are no .json file (sub-folders, notes).
  ignored: string[];
}

export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function readCatalogue(path: string): CatalogueRead {
  return isFolder(path) ? readCatalogueFolder(path) : readCatalogueFile(path);
}

export function readCatalogueFile(path: string): CatalogueRead {
  const read = readJsonObject(path);
  return "error" in read
    ? { error: read.error, skipped: [], ignored: [] }
    : { data: read.data, skipped: [], ignored: [] };
}

export function readCatalogueFolder(dir: string): CatalogueRead {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch (error) {
    return { error: `cannot read the folder (${reason(error)})`, skipped: [], ignored: [] };
  }
  const result: CatalogueRead = { skipped: [], ignored: [] };
  if (!names.includes(META_FILE)) {
    return { ...result, error: `${META_FILE} is missing; it names the language` };
  }
  const data: MessageTree = {};
  for (const name of names) {
    const path = join(dir, name);
    if (!name.endsWith(JSON_SUFFIX) || isFolder(path)) {
      result.ignored.push(name);
      continue;
    }
    const read = readJsonObject(path);
    if ("error" in read) {
      // Without its _meta the catalogue has no name: unusable as a whole.
      if (name === META_FILE) return { ...result, error: `${META_FILE}: ${read.error}` };
      result.skipped.push({ file: name, reason: read.error });
      continue;
    }
    data[name.slice(0, -JSON_SUFFIX.length)] = read.data;
  }
  return { ...result, data };
}

// The area file a message key lives in within the folder form, and the key
// inside that file: "setup.steps.token.title" -> setup.json, "steps.token.title".
export function areaFileOf(key: string): { file: string; key: string } {
  const dot = key.indexOf(".");
  if (dot < 0) return { file: `${key}${JSON_SUFFIX}`, key: "" };
  return { file: `${key.slice(0, dot)}${JSON_SUFFIX}`, key: key.slice(dot + 1) };
}

function readJsonObject(path: string): { data: MessageTree } | { error: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { error: `cannot read the file (${reason(error)})` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `not valid JSON (${reason(error)})` };
  }
  if (!isMessageTree(data)) return { error: "the file must contain one JSON object" };
  return { data };
}

function reason(error: unknown): string {
  if (error instanceof Error) return (error as NodeJS.ErrnoException).code ?? error.message;
  return String(error);
}
