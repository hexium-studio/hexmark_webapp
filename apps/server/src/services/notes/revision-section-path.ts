import { REVISION_SECTION_PATH_MAX_LENGTH, SECTION_PATH_SEPARATOR } from "@hexmark/shared";

// The section path a revision records (note_revisions.section_path, at most
// REVISION_SECTION_PATH_MAX_LENGTH characters). A longer path keeps its end,
// the part that names the section, and marks the cut with "… > " at whole
// headings; when even the last heading alone is too long, the cut falls
// inside it and is marked with "…" alone. Pure.

const ELLIPSIS = "…";
const MARK = `${ELLIPSIS}${SECTION_PATH_SEPARATOR}`;

export function revisionSectionPath(path: string): string {
  const points = Array.from(path);
  const max = REVISION_SECTION_PATH_MAX_LENGTH;
  if (points.length <= max) return path;
  const tail = points.slice(points.length - (max - Array.from(MARK).length)).join("");
  const boundary = tail.indexOf(SECTION_PATH_SEPARATOR);
  if (boundary >= 0) return MARK + tail.slice(boundary + SECTION_PATH_SEPARATOR.length);
  return ELLIPSIS + points.slice(points.length - (max - 1)).join("");
}
