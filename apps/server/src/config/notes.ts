// Settings of the notes core. One optional environment variable:
//
//   SECTION_TOKEN_BUDGET  reading budget per section in estimated tokens
//                         (default 8000). Sections above it are marked in the
//                         outline, and writes return a warning suggesting a
//                         split. Not a limit: nothing is refused.
//
// A malformed value is logged as a configuration error and the default
// applies; the server always starts.

export const DEFAULT_SECTION_TOKEN_BUDGET = 8000;
const BUDGET_RANGE = { min: 100, max: 1_000_000 } as const;

export interface SectionBudgetConfig {
  budget: number;
  problem: string | null;
}

// Pure: reads the variable from `source` without logging.
export function readSectionBudget(source: NodeJS.ProcessEnv = process.env): SectionBudgetConfig {
  const raw = source.SECTION_TOKEN_BUDGET?.trim();
  if (!raw) return { budget: DEFAULT_SECTION_TOKEN_BUDGET, problem: null };
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < BUDGET_RANGE.min || value > BUDGET_RANGE.max) {
    return {
      budget: DEFAULT_SECTION_TOKEN_BUDGET,
      problem:
        `SECTION_TOKEN_BUDGET must be a whole number between ${BUDGET_RANGE.min} and ` +
        `${BUDGET_RANGE.max}; using the default ${DEFAULT_SECTION_TOKEN_BUDGET}.`,
    };
  }
  return { budget: value, problem: null };
}

const loaded = readSectionBudget();

export const sectionTokenBudget = loaded.budget;

// Called once at start-up (src/index.ts).
export function reportNotesConfig(): void {
  if (loaded.problem) console.error(`Configuration error: ${loaded.problem}`);
}

// Folder levels get_overview shows.
export const OVERVIEW_DEPTH = 2;

// Largest accepted request body for /api/notes/v1: a note body of 1 MB plus
// JSON escaping and the other fields.
export const NOTES_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

// Largest accepted request body for /api/tokens/v1.
export const TOKENS_BODY_LIMIT_BYTES = 16 * 1024;

// api_tokens.last_used_at is written at most this often per token.
export const TOKEN_LAST_USED_INTERVAL_MS = 60_000;

// Search snippets (ts_headline): marks around matches, and what joins two
// fragments of one section; a snippet cut off at either end gets "…" there
// (services/notes/snippets.ts).
export const SNIPPET_FRAGMENT_DELIMITER = " … ";
export const SNIPPET_OPTIONS =
  "StartSel=«, StopSel=», MaxWords=35, MinWords=12, ShortWord=0, MaxFragments=2, " +
  `FragmentDelimiter="${SNIPPET_FRAGMENT_DELIMITER}"`;
