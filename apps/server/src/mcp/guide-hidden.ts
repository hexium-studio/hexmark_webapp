// The part of the agent guide (guide.ts) about hidden notes and folders,
// kept apart so the guide stays readable.

export const HIDDEN_INSTRUCTION =
  "Hidden notes and folders (hidden in reads) cannot be read or changed by agents: a " +
  "hidden note's content answers hidden, nothing below a hidden folder exists for you. " +
  "Only people unhide. hide_note and hide_folder hide with a reason.";

export const HIDDEN_GUIDE = `## Hidden
- People (and agents with the hide permission: hide_note, hide_folder, always with a
  reason) can hide a note or a folder from agents. Only people unhide.
- A hidden note stays visible with its title, path, id and \`hidden\` state (at, by,
  reason, from), but its content does not: read_note, read_outline, read_section and
  read_revision answer hidden (hiddenItem, title, hiddenAt, hiddenBy, reason).
  search_notes finds it by its title only (a hit without sectionPath, heading or
  snippet); list_revisions and list_changes leave out the section an edit changed.
- A hidden folder stays visible (name, \`hidden\` state, no counts), but everything below
  it - also what is created there later - does not exist for you: it is not listed,
  counted or found, it is not in list_changes or list_trash, and naming it by id or path
  answers not_found / folder_not_found. list_folder and search_notes on the folder itself
  answer hidden.
- You cannot change hidden items: update_note, replace_section, move_note, rename_folder,
  move_folder, delete, restore, lock_note, lock_folder, and creating or moving anything
  into a hidden folder answer hidden; so does deleting or restoring a folder that holds a
  hidden note or folder you can see (it is named). Items inside that are outside your
  reach answer forbidden with reason hidden_content instead (not named); when both lie
  inside, the answer is hidden. When the item is locked as well, the answer is still
  hidden and its locked field carries the lock (unhiding alone would not be enough);
  otherwise locked is null. Hiding is allowed on locked items; unhiding never lifts a lock.
- Hiding what is hidden itself already answers changed: false with a message.
- Hide only what agents must not read, and say why: only a person can undo it.
`;
