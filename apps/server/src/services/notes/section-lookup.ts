import { SECTION_PATH_SEPARATOR } from "@hexmark/shared";
import { sliceCodePoints, toCodeUnitOffsets } from "../../lib/code-points";
import type { Failure } from "../../lib/outcome";
import { refuse } from "./refusals";
import { UNTITLED } from "./sections";

// Finding a section by the path a client gives, and reading or replacing its
// text. Pure: works on the section rows and the body.

export interface SectionRange {
  path: string;
  level: number;
  heading: string;
  startOffset: number;
  endOffset: number;
  subtreeEndOffset: number;
}

// What finding a section needs of a section row.
export interface SectionNode {
  position: number;
  parentPosition: number | null;
  level: number;
  heading: string;
  path: string;
}

export type SectionMatch<T> =
  | { found: T }
  | { error: "section_not_found"; paths: string[] }
  | { error: "ambiguous_section"; candidates: string[] };

// Most paths listed with section_not_found, so the answer stays small.
const LISTED_PATHS = 50;

// Every way the end of a section's path can be written, lower-cased: the
// last 1, 2, ... segments of its path ("Examples (2)", "Setup > Examples (2)")
// and the same with the headings as written, without the " (2)" a repeated
// path gets ("Examples", "Setup > Examples"). So a heading that occurs twice
// matches both sections and is reported as ambiguous.
function pathEnds<T extends SectionNode>(section: T, byPosition: Map<number, T>): Set<string> {
  const segments: string[] = [];
  const headings: string[] = [];
  let current: T | undefined = section;
  while (current) {
    const parent: T | undefined =
      current.parentPosition === null ? undefined : byPosition.get(current.parentPosition);
    // A path is its parent's path + separator + its own segment.
    segments.unshift(
      parent
        ? current.path.slice(parent.path.length + SECTION_PATH_SEPARATOR.length)
        : current.path,
    );
    headings.unshift(current.level === 0 ? current.path : current.heading || UNTITLED);
    current = parent;
  }
  const ends = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    ends.add(segments.slice(i).join(SECTION_PATH_SEPARATOR).toLowerCase());
    ends.add(headings.slice(i).join(SECTION_PATH_SEPARATOR).toLowerCase());
  }
  return ends;
}

// In this order: the exact path; the path ignoring case; the end of a path
// (whole segments, down to the last heading alone, ignoring case) when it
// names exactly one section. Several matches: ambiguous_section with their
// paths; none: section_not_found with the note's paths.
export function findSection<T extends SectionNode>(
  sections: readonly T[],
  query: string,
): SectionMatch<T> {
  const wanted = query.trim();
  const exact = sections.find((section) => section.path === wanted);
  if (exact) return { found: exact };
  const lower = wanted.toLowerCase();
  const sameCase = sections.find((section) => section.path.toLowerCase() === lower);
  if (sameCase) return { found: sameCase };
  const byPosition = new Map(sections.map((section) => [section.position, section] as const));
  const matches = sections.filter((section) => pathEnds(section, byPosition).has(lower));
  if (matches.length === 1 && matches[0]) return { found: matches[0] };
  if (matches.length > 1) {
    return { error: "ambiguous_section", candidates: matches.map((section) => section.path) };
  }
  return {
    error: "section_not_found",
    paths: sections.slice(0, LISTED_PATHS).map((section) => section.path),
  };
}

// The refusal for a section that was not found, or not found once: it
// repeats the section as the client asked for it (`section`), next to the
// note's paths or the candidates.
export function sectionMissRefusal(
  match: Exclude<SectionMatch<unknown>, { found: unknown }>,
  requested: string,
): Failure {
  return match.error === "section_not_found"
    ? refuse("section_not_found", { section: requested, paths: match.paths })
    : refuse("ambiguous_section", { section: requested, candidates: match.candidates });
}

function rangeEnd(section: SectionRange, includeSubsections: boolean): number {
  return includeSubsections ? section.subtreeEndOffset : section.endOffset;
}

export function sectionText(body: string, section: SectionRange, includeSubsections: boolean) {
  return sliceCodePoints(body, section.startOffset, rangeEnd(section, includeSubsections));
}

// Ends with an empty (or blank) line: a line break, white space, a line break.
const ENDS_WITH_BLANK_LINE = /\n[ \t]*\r?\n$/;

// What `text` needs at its end so that the heading after it (`rest` starts
// with the next heading whenever it is not empty) stays a heading on its own
// line with a blank line before it: nothing, a line break, or two. Nothing
// else of the text is changed.
export function separatorBefore(text: string, rest: string): string {
  if (rest === "" || text === "" || ENDS_WITH_BLANK_LINE.test(text)) return "";
  if (text.endsWith("\r\n")) return "\r\n";
  return text.endsWith("\n") ? "\n" : "\n\n";
}

// The body with the section's range replaced by `text`, plus the separating
// blank line before the next heading when `text` lacks it. The section's own
// text, sent back unchanged, leaves the body as it is (no new version).
export function replaceSectionText(
  body: string,
  section: SectionRange,
  includeSubsections: boolean,
  text: string,
): string {
  const [start, end] = toCodeUnitOffsets(body, [
    section.startOffset,
    rangeEnd(section, includeSubsections),
  ]) as [number, number];
  if (body.slice(start, end) === text) return body;
  const rest = body.slice(end);
  return body.slice(0, start) + text + separatorBefore(text, rest) + rest;
}
