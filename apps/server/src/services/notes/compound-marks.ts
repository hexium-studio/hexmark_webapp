// Marks of hyphenated search terms in a snippet as ts_headline returns it.
// Pure.
//
// For a hyphenated word the 'simple' configuration searches the whole word
// and each part ("app-kasse" becomes 'app-kasse' <-> 'app' <-> 'kasse'), and
// ts_headline marks every word that matches any of them: next to
// "«app»-«kasse»" also "«app»-kalender" or a lone "«App»", which the query
// did not ask for. When a hyphenated query word is marked as a whole in the
// snippet, the marks of its parts elsewhere are taken off - unless the
// query also has that part as a word of its own ("app app-kasse").
// mergeMarks (snippets.ts) then joins "«app»-«kasse»" into one mark.

// A run of marked words joined by hyphens, as ts_headline marks the parts.
const MARKED_RUN = /«[^«»]*»(?:-«[^«»]*»)*/g;
const MARKED_WORD = /«([^«»]*)»/g;
const QUERY_WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

interface QueryWords {
  // Hyphenated words, lower case.
  compounds: Set<string>;
  // Words without a hyphen, lower case.
  words: Set<string>;
}

export function queryWords(query: string): QueryWords {
  const compounds = new Set<string>();
  const words = new Set<string>();
  for (const [word] of query.toLowerCase().matchAll(QUERY_WORD)) {
    (word.includes("-") ? compounds : words).add(word);
  }
  return { compounds, words };
}

function runText(run: string): string {
  return run.replace(/[«»]/g, "").toLowerCase();
}

export function unmarkCompoundParts(snippet: string, query: string): string {
  const { compounds, words } = queryWords(query);
  if (compounds.size === 0) return snippet;
  const marked = new Set([...snippet.matchAll(MARKED_RUN)].map(([run]) => runText(run)));
  const parts = new Set<string>();
  for (const compound of compounds) {
    if (!marked.has(compound)) continue;
    for (const part of compound.split("-")) if (!words.has(part)) parts.add(part);
  }
  if (parts.size === 0) return snippet;
  return snippet.replace(MARKED_RUN, (run) =>
    compounds.has(runText(run))
      ? run
      : run.replace(MARKED_WORD, (mark, word: string) =>
          parts.has(word.toLowerCase()) ? word : mark,
        ),
  );
}
