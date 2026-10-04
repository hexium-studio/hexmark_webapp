import type { McpResultField, McpToolDefinition, McpToolError } from "./definition.ts";
import { LOCK_EXAMPLES } from "./examples-lock.ts";
import { lockFields } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH, HIDDEN, LOCKED, NOTE_ADDRESS_ERRORS } from "./note-tools.ts";

// Locking. An agent with the lock permission may lock a note or a folder
// (with everything below it, also what is created there later), so that no
// agent changes it any more; only people can lift a lock, and people may
// still change locked items. Locking is no change of content: no new
// version; the audit log records it with the reason.

const RESULT: readonly McpResultField[] = [
  ["kind", "string", "note or folder."],
  ["id", "string (uuid)", "Its id."],
  ["path", "string", "Its path."],
  ...lockFields("locked"),
  [
    "changed",
    "boolean",
    "false when it held a lock of its own already: that lock stays as it was (who, when, why).",
  ],
  ["message", "string (only if changed is false)", "Says that it was locked already."],
];

// The message of locked for a lock tool (sent by the server): the item lies
// in a locked folder, so it is locked already.
export const ALREADY_LOCKED_MESSAGE =
  "It is locked already, by the folder named in lockedItem (lockedAt, lockedBy, reason): " +
  "that lock covers it, so nothing needs to be done and nothing was written.";

const INSIDE_LOCKED: McpToolError = [
  LOCKED[0],
  "A folder above it is locked already, so it is locked with it and nothing needs to be " +
    "done (details: alreadyLocked: true; lockedItem: the folder holding the lock; lockedAt, " +
    "lockedBy, reason).",
];

const KEPT =
  "Agents (this one too) can then no longer change, move, rename, delete or restore it; " +
  "reading stays possible. Only a person can unlock it.";

export const lockNote = {
  name: "lock_note",
  title: "Lock note",
  permission: "lock",
  readOnly: false,
  description:
    `Lock a note so that no agent changes it any more. ${KEPT} Give a reason; it is shown ` +
    "with the lock. Locking a note that holds a lock of its own already changes nothing " +
    "(changed: false); one in a locked folder answers locked with alreadyLocked: true. " +
    "Requires the lock permission.",
  input: input.lock_note,
  defaults: {},
  result: RESULT,
  errors: [...NOTE_ADDRESS_ERRORS, HIDDEN, INSIDE_LOCKED],
  example: LOCK_EXAMPLES.lock_note,
} satisfies McpToolDefinition<typeof input.lock_note>;

export const lockFolder = {
  name: "lock_folder",
  title: "Lock folder",
  permission: "lock",
  readOnly: false,
  description:
    "Lock a folder with everything below it, also notes and folders created there later, " +
    `so that no agent changes any of it. ${KEPT} Give a reason; it is shown with the lock. ` +
    "Locking a folder that holds a lock of its own already changes nothing (changed: false); " +
    "one inside a locked folder answers locked with alreadyLocked: true. Requires the lock " +
    "permission.",
  input: input.lock_folder,
  defaults: {},
  result: RESULT,
  errors: [
    ["folder_not_found", "No folder in use that this token can see has that id."],
    FOLDER_IN_TRASH,
    HIDDEN,
    INSIDE_LOCKED,
  ],
  example: LOCK_EXAMPLES.lock_folder,
} satisfies McpToolDefinition<typeof input.lock_folder>;
