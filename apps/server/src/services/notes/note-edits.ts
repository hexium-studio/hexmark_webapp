import { isNoteBodyWithinLimit, NOTE_BODY_MAX_BYTES, type NoteWriteResult } from "@hexmark/shared";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { NoteRef } from "./addressing";
import { readSections } from "./note-store";
import { writeNote } from "./note-write";
import { fieldRefusal } from "./refusals";
import { findSection, replaceSectionText, sectionMissRefusal } from "./section-lookup";

// Changing a note's title and body, as a whole or one section at a time.

export interface NoteUpdate {
  expectedVersion: number;
  title?: string;
  body?: string;
  reason?: string;
}

// A new body is "edited" (the snapshot holds a changed title as well); a new
// title alone is "renamed". Nothing new: no new version.
export function updateNote(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  input: NoteUpdate,
): Promise<Outcome<NoteWriteResult>> {
  return writeNote({
    ref,
    now,
    permission: "edit",
    action: "note.updated",
    input: { note, ...input },
    note,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    async plan(row) {
      const title = input.title ?? row.title;
      const body = input.body ?? row.body;
      if (body !== row.body) return { change: "edited", title, body };
      if (title !== row.title) return { change: "renamed", title };
      return null;
    },
  });
}

export interface SectionReplacement {
  expectedVersion: number;
  // Path as in the outline, or its end when that names one section.
  section: string;
  body: string;
  includeSubsections: boolean;
  reason?: string;
}

// Replaces the section's range (from its heading line on; with or without its
// subsections) by the given Markdown. The result must stay within the body
// limit, the same rule as for a whole body.
export function replaceSection(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  input: SectionReplacement,
): Promise<Outcome<NoteWriteResult>> {
  return writeNote({
    ref,
    now,
    permission: "edit",
    action: "note.section_replaced",
    input: { note, ...input },
    note,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    conflictSection: { path: input.section, includeSubsections: input.includeSubsections },
    async plan(row, { tx }) {
      const match = findSection(await readSections(tx, row.id), input.section);
      if ("error" in match) return sectionMissRefusal(match, input.section);
      const body = replaceSectionText(row.body, match.found, input.includeSubsections, input.body);
      if (!isNoteBodyWithinLimit(body)) {
        return fieldRefusal("body", "too_long", { maxBytes: NOTE_BODY_MAX_BYTES });
      }
      if (body === row.body) return null;
      return { change: "edited", body, sectionPath: match.found.path };
    },
  });
}
