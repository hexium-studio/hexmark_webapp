import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "../field-errors.ts";
import {
  INTRODUCTION_SECTION_PATH,
  NOTE_TITLE_MAX_LENGTH,
  noteAddressSchema,
  noteTitleSchema,
  REVISION_REASON_MAX_LENGTH,
  reasonSchema,
  sectionPathSchema,
  versionSchema,
} from "../notes.ts";

// Parameters several MCP tools share, with the description an agent reads
// (inputs.ts, inputs-trash.ts).

export const note = noteAddressSchema.describe(
  "The note: its id (preferred: ids never change), its title, or folder path + title " +
    "('Projects/Naming conventions'; '/Title' for the root level). A title several notes " +
    "share fails with ambiguous_note and lists the candidates.",
);
export const expectedVersion = versionSchema.describe(
  "The note's version your change is based on, from your last read. If the note has a " +
    "newer version, nothing is written and the tool fails with version_conflict.",
);
export const reason = reasonSchema.describe(
  `Why you make this change, one short sentence (max ${REVISION_REASON_MAX_LENGTH} ` +
    "characters). Optional but expected: shown in the note's history next to this token's name.",
);
// Folders keep no history: their reason goes to the audit log only.
export const folderReason = reasonSchema.describe(
  `Why you make this change, one short sentence (max ${REVISION_REASON_MAX_LENGTH} ` +
    "characters). Optional but expected: recorded in the audit log next to this token's name.",
);
export const section = sectionPathSchema.describe(
  "Section path as read_outline or search_notes give it ('Setup > Docker'), or its end " +
    "down to the last heading alone ('Docker') when that names one section only; a heading " +
    "that occurs more than once fails with ambiguous_section and lists the candidates. " +
    `Case is ignored. The text before the first heading is '${INTRODUCTION_SECTION_PATH}'.`,
);
export const title = noteTitleSchema.describe(
  `Note title: unique within its folder (case is ignored), max ${NOTE_TITLE_MAX_LENGTH} ` +
    "characters, no '/' or line breaks.",
);

const code = (value: FieldErrorCode) => value;

// A whole number in [min, max], with the field codes the HTTP API uses.
export function wholeNumber(min: number, max: number) {
  return z
    .number({ error: requiredOr("invalid_type") })
    .int(code("invalid_type"))
    .min(min, code("invalid"))
    .max(max, code("too_long"));
}

export function boundedInt(limits: { default: number; max: number }, text: string) {
  return wholeNumber(1, limits.max).optional().describe(text);
}

export function flag(text: string) {
  return z
    .boolean({ error: code("invalid_type") })
    .optional()
    .describe(text);
}
