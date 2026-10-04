// Finishes a search snippet as ts_headline cut it from a section's text
// (matches marked «like this», fragments joined by a delimiter). Pure.
//
// - Punctuation that belongs to the first or last word of a fragment and
//   that ts_headline leaves off ("…is «done»" for "…is done.") is put back:
//   a run of punctuation directly before a fragment or after it, up to the
//   next white space.
// - Marks of neighbouring words merge into one ("«getrennt» «durch»" for a
//   phrase becomes "«getrennt durch»"), also across a hyphen: ts_headline
//   marks the parts of a hyphenated word one by one ("«app»-«kalender»"),
//   which becomes "«app-kalender»" when both parts match. The marks of a
//   part on its own elsewhere ("App") are taken off before, when the query
//   did not ask for it (compound-marks.ts).
// - What ts_headline leaves off at either end without a word in it - an
//   emoji with a final period, a closing code fence - is put back when it is
//   short, so nothing is dropped silently.
// - "… " in front when text comes before the snippet that is not shown,
//   " …" at the end when text follows it: only where text was really cut.

const MARKS = /[«»]/g;
const WORD = /[\p{L}\p{N}]/u;
const ELLIPSIS = "…";
// Punctuation right after a fragment, followed by white space or the end.
const TRAILING = /^[^\s\p{L}\p{N}]+(?=\s|$)/u;
// Punctuation right before a fragment, after white space or the start.
const LEADING = /(?<=^|\s)[^\s\p{L}\p{N}]+$/u;
const SPLIT_MARKS = /»(\s+|-)«/g;
// Longest rest without words that is put back instead of being cut ("🚀.").
const SHORT_REST = 20;

// Without the match marks and with white space collapsed, so the snippet can
// be found in the text it was cut from.
function plain(value: string): string {
  return value.replace(MARKS, "").replace(/\s+/g, " ").trim();
}

// No word in it (letters or digits) and short: put back rather than cut.
function isShortRest(rest: string): boolean {
  return !WORD.test(rest) && Array.from(rest.trim()).length <= SHORT_REST;
}

export function mergeMarks(snippet: string): string {
  return snippet.replace(SPLIT_MARKS, "$1");
}

// `delimiter` joins the snippet's fragments (ts_headline FragmentDelimiter).
export function finishSnippet(snippet: string, text: string, delimiter: string): string {
  const whole = plain(text);
  const fragments = snippet.split(delimiter);
  const parts: string[] = [];
  let cursor = 0;
  let cutBefore = false;
  let cutAfter = false;
  for (const [index, fragment] of fragments.entries()) {
    const bare = plain(fragment);
    let at = bare ? whole.indexOf(bare, cursor) : -1;
    if (at < 0 && bare) at = whole.indexOf(bare);
    // Not found (the text was changed in a way plain() does not undo): leave
    // the snippet as it is rather than guess.
    if (at < 0) return mergeMarks(snippet.trim());
    const end = at + bare.length;
    let before = whole.slice(0, at).match(LEADING)?.[0] ?? "";
    let after = whole.slice(end).match(TRAILING)?.[0] ?? "";
    if (index === 0) {
      const lead = whole.slice(0, at - before.length);
      if (isShortRest(lead)) before = `${lead.trimStart()}${before}`;
      else cutBefore = lead.trim() !== "";
    }
    if (index === fragments.length - 1) {
      const rest = whole.slice(end + after.length);
      if (isShortRest(rest)) after = `${after}${rest.trimEnd()}`;
      else cutAfter = rest.trim() !== "";
    }
    parts.push(`${before}${fragment.trim()}${after}`);
    cursor = end;
  }
  const body = mergeMarks(parts.join(delimiter));
  return `${cutBefore ? `${ELLIPSIS} ` : ""}${body}${cutAfter ? ` ${ELLIPSIS}` : ""}`;
}

// Relevance relative to the best hit: 1 for the best, three decimals. A raw
// ts_rank says nothing on its own (with -word it can be 1e-20 for a good
// hit), only next to the others of the same search.
export function relativeRanks(ranks: readonly number[]): number[] {
  const best = Math.max(0, ...ranks);
  if (!(best > 0)) return ranks.map(() => 1);
  return ranks.map((rank) => Math.round((Math.max(rank, 0) / best) * 1000) / 1000);
}
