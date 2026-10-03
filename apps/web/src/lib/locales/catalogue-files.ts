import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isLocale, type Locale } from "@hexmark/shared";
import type { MessageTree } from "@hexmark/shared/translation-check";
import {
  type CatalogueEntry,
  catalogueEntry,
  isFolder,
  readCatalogue,
} from "@hexmark/shared/translation-files";
import { logLocales } from "./log";

// Finds the translations on disk. Each is a catalogue in one of two forms
// (packages/shared/src/translation-files.ts): a <code>.json file or a <code>/
// folder with _meta.json and one <area>.json per area. Read once per server
// process (see registry.ts), so translations added or changed later need a
// restart.

export type CatalogueOrigin = "built-in" | "custom";

export interface CatalogueFile {
  code: Locale;
  origin: CatalogueOrigin;
  // For log lines, e.g. "custom/ru.json" or "custom/ru/".
  label: string;
  data: MessageTree;
}

// Built-in catalogues ship with the app: apps/web/messages/<code>/. The
// working directory is apps/web under `next dev` / `next start` and in the
// standalone server, which changes into its own folder; next.config.ts
// copies the folder into the standalone output.
export function builtInDir(): string {
  return join(process.cwd(), "messages");
}

// Custom catalogues: HEXMARK_LOCALES_DIR (the Docker image sets
// /app/locales/custom, see apps/web/Dockerfile), else locales/ at the
// repository root for `pnpm dev`.
export function customDir(): string {
  const configured = process.env.HEXMARK_LOCALES_DIR?.trim();
  return configured ? resolve(configured) : resolve(process.cwd(), "../../locales");
}

function listEntries(dir: string): string[] | undefined {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch {
    return undefined;
  }
}

// The catalogues in `dir`, one per code. Where <code>.json and <code>/ both
// exist, the folder wins. Everything that cannot be used is skipped with a
// log line; the messages are checked later (catalogue.ts).
export function readCatalogueFiles(dir: string, origin: CatalogueOrigin): CatalogueFile[] {
  const names = listEntries(dir);
  if (!names) {
    if (origin === "custom") logLocales("info", `no custom translations (${dir} not found)`);
    else logLocales("error", `built-in translations not found in ${dir}`);
    return [];
  }
  const entries = new Map<string, CatalogueEntry>();
  const ignored: string[] = [];
  for (const name of names) {
    const folder = isFolder(join(dir, name));
    const entry = catalogueEntry(name, folder);
    if (!entry) {
      if (name.endsWith(".json") || folder) {
        const rule = folder ? "a locale code such as ru or pt-BR" : "such as ru.json or pt-BR.json";
        logLocales("warn", `skipped ${origin}/${name}: the name must be ${rule}`);
      } else ignored.push(name);
      continue;
    }
    const other = entries.get(entry.code);
    if (other) {
      const [file, kept] = entry.form === "folder" ? [other, entry] : [entry, other];
      logLocales(
        "warn",
        `ignored ${origin}/${file.name}: ${origin}/${kept.name}/ exists as well and is used for ${entry.code}`,
      );
      entries.set(entry.code, kept);
    } else entries.set(entry.code, entry);
  }
  if (ignored.length > 0) {
    logLocales("info", `ignored in ${dir}: ${ignored.join(", ")} (no translation)`);
  }
  return [...entries.values()].flatMap((entry) => readOne(dir, origin, entry));
}

function readOne(dir: string, origin: CatalogueOrigin, entry: CatalogueEntry): CatalogueFile[] {
  const label = `${origin}/${entry.name}${entry.form === "folder" ? "/" : ""}`;
  const read = readCatalogue(join(dir, entry.name));
  if (!read.data) {
    logLocales("warn", `skipped ${label}: ${read.error}`);
    return [];
  }
  for (const { file, reason } of read.skipped) {
    logLocales("warn", `skipped ${label}${file}: ${reason}; its messages fall back`);
  }
  if (read.ignored.length > 0) {
    logLocales("info", `ignored in ${label}: ${read.ignored.join(", ")} (not a .json file)`);
  }
  // catalogueEntry only accepts names of the locale code form.
  if (!isLocale(entry.code)) return [];
  return [{ code: entry.code, origin, label, data: read.data }];
}
