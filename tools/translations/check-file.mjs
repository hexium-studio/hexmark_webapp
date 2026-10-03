// Checks one translation catalogue – a <code>.json file or a <code>/ folder –
// and describes the result as lines for print.mjs. Strict mode (built-in
// catalogues) turns every finding into an error; report mode (user
// catalogues) says what the web app will do with it instead. In the folder
// form every finding names the area file it is in.

import { basename } from "node:path";
import {
  checkMeta,
  compareMessages,
  UNUSABLE_MESSAGE,
} from "../../packages/shared/src/translation-check.ts";
import {
  areaFileOf,
  catalogueEntry,
  isFolder,
  META_FILE,
  readCatalogue,
} from "../../packages/shared/src/translation-files.ts";

function count(list, noun) {
  return `${list.length} ${noun}${list.length === 1 ? "" : "s"}`;
}

// What a user catalogue falls back to where its own message is missing or unusable.
function fallbackOf(code, builtInCodes) {
  if (code?.includes("-")) return `${code.split("-")[0]} (if available) or English`;
  if (code && code !== "en" && builtInCodes.has(code)) return `the built-in ${code} text`;
  return "English";
}

// Message keys by the file they live in: one group for the file form, one
// per area file for the folder form (keys then relative to that file).
function byFile(keys, folder) {
  if (!folder) return [["", keys]];
  const groups = new Map();
  for (const key of keys) {
    const { file, key: inner } = areaFileOf(key);
    groups.set(file, [...(groups.get(file) ?? []), inner]);
  }
  return [...groups];
}

const at = (file, text) => (file ? `${file}: ${text}` : text);

const NAME_RULE = {
  file: 'file name must be <code>.json, e.g. "ru.json" or "pt-BR.json" (language in lower case, region in upper case)',
  folder:
    'folder name must be a locale code, e.g. "ru" or "pt-BR" (language in lower case, region in upper case)',
};

// `shadowedBy`: a folder of the same code next to this file; the app uses the folder.
export function checkFile(path, { mode, reference, builtInCodes, shadowedBy }) {
  const strict = mode === "strict";
  const folder = isFolder(path);
  const lines = [];
  let unusable = false;
  const error = (text, keys) => lines.push({ level: "error", text, keys });
  const warn = (text, keys) => lines.push({ level: strict ? "error" : "warning", text, keys });
  const note = (text, keys) => lines.push({ level: "note", text, keys });

  const code = catalogueEntry(basename(path), folder)?.code;
  if (!code) {
    error(NAME_RULE[folder ? "folder" : "file"]);
    unusable = true;
  }
  if (strict && !folder) {
    error(
      `built-in translations use the folder form: <code>/ with ${META_FILE} and <area>.json files`,
    );
  }
  if (shadowedBy)
    warn(`${shadowedBy} exists as well; the web app uses the folder and ignores this file`);
  const read = readCatalogue(path);
  if (!read.data) {
    error(read.error);
    return { code, lines, failed: true };
  }
  const meta = checkMeta(read.data);
  const metaWhere = folder ? META_FILE : '"_meta"';
  for (const text of meta.errors)
    error(`${text}; ${metaWhere} needs { "name": "<language name>", "dir": "ltr" | "rtl" }`);
  if (meta.errors.length > 0) unusable = true;
  // The app would skip the catalogue; details about its messages would only
  // bury the reason.
  if (unusable) return { code, name: meta.meta?.name, lines, failed: true };

  const fallback = fallbackOf(code, builtInCodes);
  if (read.ignored.length > 0)
    warn(`ignoring ${read.ignored.join(", ")} (only .json files are read)`);
  for (const { file, reason } of read.skipped) {
    warn(`${file}: ${reason}${strict ? "" : ` – its messages show in ${fallback}`}`);
  }
  const overlay = code.includes("-");
  const dirDefault = overlay ? "taken from the language" : '"ltr" is used';
  // An overlay without "dir" simply inherits it; only a wrong value is a problem.
  const inherits = overlay && !strict && read.data._meta.dir === undefined;
  for (const text of meta.warnings) {
    if (inherits) note(`"_meta.dir" not set, ${dirDefault}`);
    else warn(strict ? text : `${text}; ${dirDefault}`);
  }

  const { _meta, ...messages } = read.data;
  const issues = compareMessages(reference, messages);
  const byKind = (kind) => issues.filter((issue) => issue.kind === kind).map((i) => i.key);
  const skipped = new Set(read.skipped.map((entry) => entry.file));

  // Messages of an unreadable area file were reported with the file.
  const missing = byKind("missing").filter((key) => !folder || !skipped.has(areaFileOf(key).file));
  if (missing.length > 0 && overlay) {
    if (!strict) note(`${count(missing, "message")} not in this overlay, taken from ${fallback}`);
  } else {
    for (const [file, keys] of byFile(missing, folder)) {
      const absent = folder && !(file.slice(0, -".json".length) in messages);
      const what = `${count(keys, "message")} missing${absent ? " (file not found)" : ""}`;
      if (strict) error(at(file, `${what}:`), keys);
      else if (fallback === "English") warn(at(file, `${what}, they will show in English:`), keys);
      else
        note(at(file, `${count(keys, "message")} not in this file, ${fallback} is used for them`));
    }
  }
  const ignoredNote = strict ? "" : ", ignored";
  for (const [file, keys] of byFile(byKind("extra"), folder)) {
    if (folder && keys.includes(""))
      warn(`${file}: not an area of en/ (unknown file${ignoredNote})`);
    const inner = keys.filter((key) => key !== "");
    if (inner.length === 0) continue;
    warn(
      at(file, `${count(inner, "unknown key")}${strict ? "" : " (not in English, ignored)"}:`),
      inner,
    );
  }
  for (const issue of issues.filter((found) => UNUSABLE_MESSAGE.has(found.kind))) {
    const consequence = strict ? "" : ` – shows ${fallback} instead`;
    const { file, key } = folder ? areaFileOf(issue.key) : { file: "", key: issue.key };
    warn(at(file, `${key}: ${issue.detail}${consequence}`));
  }

  const failed = strict && lines.some((line) => line.level === "error");
  return { code, name: meta.meta?.name, lines, failed };
}
