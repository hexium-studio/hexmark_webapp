import type { McpResultField, McpToolDefinition } from "./definition.ts";
import { HIDE_EXAMPLES } from "./examples-hide.ts";
import { hiddenFields } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH, NOTE_ADDRESS_ERRORS } from "./note-tools.ts";

// Hiding. An agent with the hide permission may hide a note (its content
// can no longer be read by agents) or a folder (everything below it, also
// what is created there later, no longer exists for agents). Agents cannot
// change hidden items either; only people can unhide, and people read and
// change hidden items as usual. Hiding is no change of content: no new
// version; the audit log records it with the reason.

const RESULT: readonly McpResultField[] = [
  ["kind", "string", "note or folder."],
  ["id", "string (uuid)", "Its id."],
  ["path", "string", "Its path."],
  ...hiddenFields("hidden"),
  [
    "changed",
    "boolean",
    "false when it was hidden itself already: that mark stays as it was (who, when, why).",
  ],
  ["message", "string (only if changed is false)", "Says that it was hidden already."],
];

const KEPT =
  "Agents (this one too) can then no longer change, move, rename, delete, restore or lock " +
  "it, and only a person can unhide it. A lock it has stays; hiding a locked item is allowed.";

export const hideNote = {
  name: "hide_note",
  title: "Hide note",
  permission: "hide",
  readOnly: false,
  description:
    "Hide a note's content from agents: its title, path and id stay visible, but its body, " +
    "outline, sections and the bodies of its revisions can no longer be read by any agent " +
    `(error hidden), and search finds it by its title only. ${KEPT} Give a reason; it is ` +
    "shown with the hidden note. Hiding a note that is hidden already changes nothing " +
    "(changed: false). Requires the hide permission.",
  input: input.hide_note,
  defaults: {},
  result: RESULT,
  errors: NOTE_ADDRESS_ERRORS,
  example: HIDE_EXAMPLES.hide_note,
} satisfies McpToolDefinition<typeof input.hide_note>;

export const hideFolder = {
  name: "hide_folder",
  title: "Hide folder",
  permission: "hide",
  readOnly: false,
  description:
    "Hide a folder from agents with everything below it, also notes and folders created " +
    "there later: the folder itself stays visible (name, hidden state), but nothing below it " +
    "exists for any agent any more - not in listings, search, changes or the trash, and " +
    `addressing it answers not found. ${KEPT} Give a reason; it is shown with the hidden ` +
    "folder. Hiding a folder that is hidden already changes nothing (changed: false). " +
    "Requires the hide permission.",
  input: input.hide_folder,
  defaults: {},
  result: RESULT,
  errors: [
    [
      "folder_not_found",
      "No folder in use that this token can see has that id (also any folder below a " +
        "hidden one).",
    ],
    FOLDER_IN_TRASH,
  ],
  example: HIDE_EXAMPLES.hide_folder,
} satisfies McpToolDefinition<typeof input.hide_folder>;
