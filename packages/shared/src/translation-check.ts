import { compatible, readSignature, type Signature } from "./icu-signature.ts";

// Checks a translation catalogue against the English reference
// (apps/web/messages/en/). Works on the catalogue as one tree – "_meta" plus
// one key per area – whichever form it was stored in; translation-files.ts
// reads both forms into that tree. One rule set for two callers:
// tools/check-translations.mjs (strict for built-in catalogues, a report for
// user ones) and the web app's locale registry, which loads user catalogues
// tolerantly and drops what does not pass. The callers decide what an issue
// means; this module only finds them.
// Relative imports carry the .ts extension: the tool loads these files with
// plain Node (type stripping), which does not resolve extension-less paths.

export type MessageTree = { [key: string]: unknown };

export function isMessageTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type TranslationIssueKind =
  // A key of the reference has no message (fine for region overlays).
  | "missing"
  // A key the reference does not have; it is never shown.
  | "extra"
  // A string where the reference has a group, or the other way round.
  | "shape"
  // The message is not valid ICU MessageFormat.
  | "syntax"
  // Placeholders or tags differ from the reference.
  | "arguments"
  // plural/select arguments do not fit the reference.
  | "structure";

export interface TranslationIssue {
  kind: TranslationIssueKind;
  // Dotted path, e.g. "setup.steps.token.intro".
  key: string;
  detail: string;
}

// Issues that make a message unusable: it falls back to the next language.
export const UNUSABLE_MESSAGE: ReadonlySet<TranslationIssueKind> = new Set([
  "shape",
  "syntax",
  "arguments",
  "structure",
]);

export interface LocaleMeta {
  name: string;
  // Undefined when the catalogue does not say (a region overlay inherits it).
  dir?: "ltr" | "rtl";
}

export interface MetaCheck {
  meta?: LocaleMeta;
  // The catalogue cannot be used at all.
  errors: string[];
  // The catalogue can be used, but something in _meta was ignored.
  warnings: string[];
}

// "_meta": { "name": "Deutsch", "dir": "ltr" } – the language's own name for
// the pickers and its writing direction for <html dir>.
export function checkMeta(file: MessageTree): MetaCheck {
  const meta = file._meta;
  if (!isMessageTree(meta))
    return { errors: ['"_meta" is missing or not an object'], warnings: [] };
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  if (name === "") return { errors: ['"_meta.name" is missing or empty'], warnings: [] };
  const warnings: string[] = [];
  let dir: LocaleMeta["dir"];
  if (meta.dir === "ltr" || meta.dir === "rtl") dir = meta.dir;
  else if (meta.dir === undefined) warnings.push('"_meta.dir" is missing ("ltr" or "rtl")');
  else warnings.push(`"_meta.dir" must be "ltr" or "rtl", not ${JSON.stringify(meta.dir)}`);
  return { meta: { name, dir }, errors: [], warnings };
}

// Compares every message of `candidate` with `reference` (both without
// _meta). Checking the reference against itself finds its own syntax errors.
export function compareMessages(
  reference: MessageTree,
  candidate: MessageTree,
): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  walk(reference, candidate, "", issues);
  return issues;
}

function walk(
  reference: MessageTree,
  candidate: MessageTree,
  prefix: string,
  out: TranslationIssue[],
) {
  for (const [name, expected] of Object.entries(reference)) {
    const key = prefix + name;
    const actual = candidate[name];
    if (actual === undefined) {
      for (const leaf of leafKeys(expected, key))
        out.push({ kind: "missing", key: leaf, detail: "" });
    } else if (isMessageTree(expected)) {
      if (isMessageTree(actual)) walk(expected, actual, `${key}.`, out);
      else out.push({ kind: "shape", key, detail: "must be a group of messages (an object)" });
    } else if (typeof actual !== "string") {
      out.push({ kind: "shape", key, detail: "must be a text (a string)" });
    } else if (typeof expected === "string") {
      out.push(...compareMessage(key, expected, actual));
    }
  }
  for (const name of Object.keys(candidate)) {
    if (prefix === "" && name === "_meta") continue;
    if (!(name in reference)) out.push({ kind: "extra", key: prefix + name, detail: "" });
  }
}

// Every message key below `value` (the key itself for a string).
export function leafKeys(value: unknown, key: string): string[] {
  if (!isMessageTree(value)) return [key];
  return Object.entries(value).flatMap(([name, child]) => leafKeys(child, `${key}.${name}`));
}

function compareMessage(key: string, expected: string, actual: string): TranslationIssue[] {
  let found: Signature;
  try {
    found = readSignature(actual);
  } catch (error) {
    return [{ kind: "syntax", key, detail: syntaxDetail(error, actual) }];
  }
  // The reference is checked on its own (against itself); here it only serves
  // as the template.
  let wanted: Signature;
  try {
    wanted = readSignature(expected);
  } catch {
    return [];
  }
  const issues: TranslationIssue[] = [];
  const issue = (kind: TranslationIssueKind, detail: string) => issues.push({ kind, key, detail });
  for (const [name, kind] of found.kinds) {
    const want = wanted.kinds.get(name);
    if (want === undefined) issue("arguments", `unknown ${label(name)} (not in English)`);
    else if (!compatible(want, kind)) {
      issue("structure", `${label(name)} is a ${kind} here, a ${want} in English`);
    }
  }
  for (const name of wanted.kinds.keys()) {
    if (!found.kinds.has(name)) issue("arguments", `${label(name)} is missing`);
  }
  for (const [name, options] of wanted.selectOptions) {
    const own = found.selectOptions.get(name);
    if (!own) continue;
    const lacking = [...options].filter((option) => !own.has(option));
    const unknown = [...own].filter((option) => !options.has(option));
    if (lacking.length > 0) issue("structure", `select {${name}} lacks: ${lacking.join(", ")}`);
    if (unknown.length > 0)
      issue("structure", `select {${name}} has unknown: ${unknown.join(", ")}`);
  }
  for (const option of found.badPluralOptions) {
    issue(
      "structure",
      `"${option}" is not a plural category (zero, one, two, few, many, other, =N)`,
    );
  }
  return issues;
}

function label(name: string): string {
  return name.startsWith("<") ? `tag ${name}` : `placeholder {${name}}`;
}

// The parser only names the problem (e.g. MALFORMED_ARGUMENT); the text
// helps to find it.
function syntaxDetail(error: unknown, text: string): string {
  const reason = error instanceof Error ? error.message : String(error);
  const shown = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  return `invalid ICU message syntax (${reason}) in ${JSON.stringify(shown)}`;
}
