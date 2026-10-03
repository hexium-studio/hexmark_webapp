// Prints the result of checkFile() as a readable block per file.

const LABELS = { error: "error  ", warning: "warning", note: "note   " };

// Long key lists are cut after this many unless --all is given.
const KEY_LIMIT = 10;

export function printResult(displayPath, { code, name, lines, failed }, { all = false } = {}) {
  const about = name ? ` – ${name}${code ? ` (${code})` : ""}` : "";
  console.log(`${displayPath}${about}`);
  if (lines.length === 0) console.log("  ok");
  for (const { level, text, keys } of lines) {
    console.log(`  ${LABELS[level]}  ${text}`);
    const shown = all ? (keys ?? []) : (keys ?? []).slice(0, KEY_LIMIT);
    for (const key of shown) console.log(`             ${key}`);
    const hidden = (keys?.length ?? 0) - shown.length;
    if (hidden > 0) console.log(`             … and ${hidden} more (--all lists them)`);
  }
  if (lines.length > 0) console.log(failed ? "  => FAILED" : "  => usable");
  console.log("");
}
