import type { FullNote, NoteHeader, OutlineSection, SectionText } from "@hexmark/shared";
import { sectionTokenBudget } from "../../config/notes";
import { countCodePoints } from "../../lib/code-points";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { NoteRef } from "./addressing";
import { noteHeader, readSections } from "./note-store";
import { findNote, noteTarget, withRead } from "./read-frame";
import { isFailure } from "./refusals";
import { textChunk } from "./section-chunks";
import { findSection, sectionMissRefusal, sectionText } from "./section-lookup";
import { approxTokens } from "./sections";

// Reading notes: whole, as an outline, or one section.

export function readFullNote(ref: AccessRef, now: Date, note: NoteRef): Promise<Outcome<FullNote>> {
  const request = { ref, now, permission: "read", action: "read.note", input: { note } } as const;
  return withRead(
    request,
    async (context) => {
      const row = await findNote(context, note);
      if (isFailure(row)) return row;
      return {
        ...noteHeader(row, context.index),
        body: row.body,
        metadata: row.metadata,
        characters: countCodePoints(row.body),
        approxTokens: approxTokens(row.body),
      };
    },
    (read, { index }) => ({
      target: noteTarget(read, index),
      details: { version: read.version, characters: read.characters },
    }),
  );
}

export interface Outline {
  note: NoteHeader;
  budget: number;
  sections: OutlineSection[];
}

export function readOutline(ref: AccessRef, now: Date, note: NoteRef): Promise<Outcome<Outline>> {
  const request = {
    ref,
    now,
    permission: "read",
    action: "read.outline",
    input: { note },
  } as const;
  return withRead(
    request,
    async (context) => {
      const row = await findNote(context, note);
      if (isFailure(row)) return row;
      const sections = (await readSections(context.tx, row.id)).map((section) => ({
        position: section.position,
        level: section.level,
        heading: section.heading,
        path: section.path,
        parentPosition: section.parentPosition,
        characters: section.characters,
        approxTokens: section.approxTokens,
        overBudget: section.approxTokens > sectionTokenBudget,
      }));
      return { note: noteHeader(row, context.index), budget: sectionTokenBudget, sections };
    },
    (read, { index }) => ({
      target: noteTarget(read.note, index),
      details: { version: read.note.version, sectionCount: read.sections.length },
    }),
  );
}

export interface SectionRead {
  note: NoteHeader;
  section: SectionText;
}

export interface SectionRequest {
  path: string;
  includeSubsections: boolean;
  // Reading in pieces (section-chunks.ts); left out: the whole section.
  offset?: number;
  limit?: number;
}

export function readSection(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  request: SectionRequest,
): Promise<Outcome<SectionRead>> {
  const { path, includeSubsections } = request;
  const input = {
    note,
    section: path,
    includeSubsections,
    offset: request.offset,
    limit: request.limit,
  };
  const read = { ref, now, permission: "read", action: "read.section", input } as const;
  return withRead(
    read,
    async (context) => {
      const row = await findNote(context, note);
      if (isFailure(row)) return row;
      const match = findSection(await readSections(context.tx, row.id), path);
      if ("error" in match) return sectionMissRefusal(match, path);
      const whole = sectionText(row.body, match.found, includeSubsections);
      const { text, ...piece } = textChunk(whole, request.offset, request.limit);
      return {
        note: noteHeader(row, context.index),
        section: {
          path: match.found.path,
          level: match.found.level,
          heading: match.found.heading,
          includesSubsections: includeSubsections,
          text,
          characters: piece.returned,
          approxTokens: approxTokens(text),
          ...piece,
        },
      };
    },
    (value, { index }) => ({
      target: noteTarget(value.note, index),
      details: {
        version: value.note.version,
        sectionPath: value.section.path,
        returned: value.section.returned,
        total: value.section.total,
      },
    }),
  );
}
