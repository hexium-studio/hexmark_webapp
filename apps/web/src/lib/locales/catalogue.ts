import { type Locale, parentLocale } from "@hexmark/shared";
import {
  checkMeta,
  compareMessages,
  isMessageTree,
  type MessageTree,
  type TranslationIssue,
  UNUSABLE_MESSAGE,
} from "@hexmark/shared/translation-check";
import type { CatalogueFile } from "./catalogue-files";
import type { LocaleInfo, LocaleSource } from "./locale-info";
import { logLocales } from "./log";

// Turns the translation catalogues into the locales the app offers, each with a
// complete set of messages. Built-in catalogues are checked strictly at build time
// (tools/check-translations.mjs); here every catalogue is checked tolerantly with
// the same rules (packages/shared/src/translation-check.ts): whatever does not
// fit English is left out and comes from the fallback chain instead.
//   chain:     region -> language -> English, e.g. de-CH -> de -> en
//   per code:  a custom catalogue over the built-in one of the same code

export const FALLBACK_LOCALE = "en" as Locale;

export interface Catalogue {
  // Sorted by name; pickers arrange them in blocks (picker-locales.ts).
  locales: readonly LocaleInfo[];
  // Complete message trees (every key of English) per available locale.
  messages: ReadonlyMap<Locale, MessageTree>;
}

// One usable catalogue: its _meta and only those messages that passed the checks.
interface Layer {
  name: string;
  dir?: "ltr" | "rtl";
  messages: MessageTree;
}

interface CodeLayers {
  builtIn?: Layer;
  custom?: Layer;
}

export function buildCatalogue(builtIn: CatalogueFile[], custom: CatalogueFile[]): Catalogue {
  const english = builtIn.find((file) => file.code === FALLBACK_LOCALE);
  if (!english)
    throw new Error(
      "[locales] the built-in English translation (messages/en/) is missing; the app cannot start",
    );
  const { _meta, ...reference } = english.data;
  const builtInCodes = new Set(builtIn.map((file) => file.code));

  const layers = new Map<Locale, CodeLayers>();
  for (const file of [...builtIn, ...custom]) {
    const layer = toLayer(file, reference, fallbackOf(file, builtInCodes));
    if (!layer) continue;
    const entry = layers.get(file.code) ?? {};
    if (file.origin === "built-in") entry.builtIn = layer;
    else entry.custom = layer;
    layers.set(file.code, entry);
  }
  if (!layers.get(FALLBACK_LOCALE)?.builtIn) {
    throw new Error(
      "[locales] the built-in English translation (messages/en/) is not usable; the app cannot start",
    );
  }

  const own = (code: Locale | undefined) => (code ? layers.get(code) : undefined);
  const locales: LocaleInfo[] = [];
  const messages = new Map<Locale, MessageTree>();
  for (const [code, entry] of layers) {
    const parent = own(parentLocale(code));
    const chain = [own(FALLBACK_LOCALE), parent, entry];
    messages.set(
      code,
      chain.reduce<MessageTree>((tree, step) => merge(tree, combined(step)), {}),
    );
    const name = entry.custom?.name ?? entry.builtIn?.name ?? code;
    const dir = ownDir(entry) ?? ownDir(parent) ?? "ltr";
    locales.push({ code, name, dir, source: sourceOf(entry, parent) });
  }
  locales.sort((a, b) => a.name.localeCompare(b.name, "en") || a.code.localeCompare(b.code));
  logLocales("info", `available: ${locales.map(describe).join(", ")}`);
  return { locales, messages };
}

// See LocaleSource. A region file counts as an override when its language
// is built in: it only adjusts a language Hexmark already ships.
function sourceOf(entry: CodeLayers, parent: CodeLayers | undefined): LocaleSource {
  if (entry.builtIn) return entry.custom ? "custom-override" : "built-in";
  return parent?.builtIn ? "custom-override" : "custom-new";
}

function ownDir(entry: CodeLayers | undefined): Layer["dir"] {
  return entry?.custom?.dir ?? entry?.builtIn?.dir;
}

function combined(entry: CodeLayers | undefined): MessageTree {
  return merge(entry?.builtIn?.messages ?? {}, entry?.custom?.messages ?? {});
}

function describe(info: LocaleInfo): string {
  const source = info.source === "built-in" ? "" : `, ${info.source.replace("-", " ")}`;
  return `${info.code} (${info.name}${source})`;
}

// What a catalogue's missing or unusable messages are shown in instead.
function fallbackOf(file: CatalogueFile, builtInCodes: Set<Locale>): string {
  const parent = parentLocale(file.code);
  if (parent) return `${parent} or English`;
  if (file.origin === "custom" && builtInCodes.has(file.code)) return `built-in ${file.code}`;
  return "English";
}

function toLayer(file: CatalogueFile, reference: MessageTree, fallback: string): Layer | undefined {
  const meta = checkMeta(file.data);
  if (!meta.meta) {
    logLocales("warn", `skipped ${file.label}: ${meta.errors.join("; ")}`);
    return undefined;
  }
  const { _meta, ...data } = file.data;
  // A region overlay without "dir" inherits it from its language; only a
  // wrong value is worth a warning there.
  const overlay = parentLocale(file.code) !== undefined;
  const inherits = overlay && isMessageTree(_meta) && _meta.dir === undefined;
  const dirDefault = overlay ? "taken from the language" : "using ltr";
  for (const warning of inherits ? [] : meta.warnings) {
    logLocales("warn", `${file.label}: ${warning}, ${dirDefault}`);
  }
  const issues = compareMessages(reference, data);
  report(file, issues, fallback);
  const rejected = new Set(
    issues.filter((issue) => UNUSABLE_MESSAGE.has(issue.kind)).map((issue) => issue.key),
  );
  return { ...meta.meta, messages: usable(reference, data, rejected, "") };
}

function report(file: CatalogueFile, issues: TranslationIssue[], fallback: string): void {
  const prefix = `${file.code} (${file.label})`;
  const keys = (kind: TranslationIssue["kind"]) =>
    issues.filter((issue) => issue.kind === kind).map((issue) => issue.key);
  const missing = keys("missing").length;
  if (missing > 0 && fallback === "English") {
    logLocales("warn", `${prefix}: ${count(missing, "key")} missing, shown in English`);
  } else if (missing > 0) {
    logLocales(
      "info",
      `${prefix}: ${count(missing, "key")} not in this translation, taken from ${fallback}`,
    );
  }
  // In the folder form (label "custom/ru/") an unknown area is a file.
  const folder = file.label.endsWith("/");
  const extra = keys("extra").map((key) => (folder && !key.includes(".") ? `${key}.json` : key));
  if (extra.length > 0) {
    logLocales(
      "warn",
      `${prefix}: ${count(extra.length, "unknown key")} ignored: ${extra.join(", ")}`,
    );
  }
  for (const issue of issues.filter((found) => UNUSABLE_MESSAGE.has(found.kind))) {
    logLocales(
      "warn",
      `${prefix}: "${issue.key}" not used (${issue.detail}), shown in ${fallback}`,
    );
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// The messages of `candidate` that exist in `reference` with the same shape
// and passed the checks: the result has a subset of the reference's keys.
function usable(
  reference: MessageTree,
  candidate: MessageTree,
  rejected: ReadonlySet<string>,
  prefix: string,
): MessageTree {
  const result: MessageTree = {};
  for (const [name, expected] of Object.entries(reference)) {
    const key = prefix + name;
    const value = candidate[name];
    if (isMessageTree(expected) && isMessageTree(value)) {
      const group = usable(expected, value, rejected, `${key}.`);
      if (Object.keys(group).length > 0) result[name] = group;
    } else if (typeof expected === "string" && typeof value === "string" && !rejected.has(key)) {
      result[name] = value;
    }
  }
  return result;
}

// `over` wins wherever it has a message; both are shaped like the reference.
function merge(base: MessageTree, over: MessageTree): MessageTree {
  const result: MessageTree = { ...base };
  for (const [name, value] of Object.entries(over)) {
    const current = result[name];
    result[name] = isMessageTree(current) && isMessageTree(value) ? merge(current, value) : value;
  }
  return result;
}
