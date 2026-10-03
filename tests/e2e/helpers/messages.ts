import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_DIR } from "../../support/paths";

// The UI texts the tests look for, straight from the message files
// (apps/web/messages/<locale>/<area>.json), so a reworded message does not
// break a test. ICU placeholders are filled with fill().

type Tree = { [key: string]: string | Tree };

export type UiLocale = "en" | "de";

const cache = new Map<UiLocale, Tree>();

function load(locale: UiLocale): Tree {
  const cached = cache.get(locale);
  if (cached) return cached;
  const dir = join(WEB_DIR, "messages", locale);
  const tree: Tree = {};
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    tree[file.slice(0, -".json".length)] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  cache.set(locale, tree);
  return tree;
}

// A message by its dotted key, e.g. text("de", "setup.token.verify").
export function text(locale: UiLocale, key: string, values: Record<string, string | number> = {}) {
  let node: string | Tree | undefined = load(locale);
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") throw new Error(`no message ${locale}:${key}`);
  return fill(node, values);
}

// Simple placeholders only ({name}); enough for the texts the tests use.
export function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in values ? String(values[name]) : all,
  );
}

// Messages may contain tags such as <code>; the page shows their content.
export function plain(message: string): string {
  return message.replace(/<\/?\w+>/g, "");
}
