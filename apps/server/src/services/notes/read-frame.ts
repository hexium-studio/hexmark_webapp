import type { AuditAction, NotePermission } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize, type Grant } from "../access/authorize";
import { recordAgentRead } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import type { AuditTarget } from "../audit/record";
import { summarizeInput } from "../audit/sanitize";
import { type NoteRef, resolveNoteRef } from "./addressing";
import { type FolderIndex, joinPath, loadFolderIndex } from "./folder-index";
import { type NoteRow, readLiveNote } from "./note-store";
import { isFailure, refuse } from "./refusals";

// The frame of every read of notes, folders and the trash: authorize, read,
// and log an agent's read (services/audit) in one transaction; a refused
// read is logged afterwards, for people too.

export interface ReadContext {
  tx: Transaction;
  grant: Grant;
  index: FolderIndex;
}

export interface ReadRequest {
  ref: AccessRef;
  now: Date;
  permission: NotePermission;
  // Logged for agents (an API token), and for every caller when refused.
  action: AuditAction;
  input?: unknown;
}

// What an agent's read is logged with besides its input: the note or folder
// read and facts about the answer (sizes, counts).
export interface ReadLog {
  target?: AuditTarget | null;
  details?: Record<string, unknown>;
}

// Every read: authorize, then the read itself, in one transaction; an
// agent's read is logged in it (services/audit), a refused one afterwards.
export function withRead<T>(
  request: ReadRequest,
  read: (context: ReadContext) => Promise<T | Failure>,
  log?: (value: T, context: ReadContext) => ReadLog,
): Promise<Outcome<T>> {
  const { ref, now, permission, action, input } = request;
  return runAudited({ ref, action, input }, async (tx) => {
    const grant = await authorize(tx, ref, now, permission);
    if (isFailure(grant)) return grant;
    const context = { tx, grant, index: await loadFolderIndex(tx) };
    const value = await read(context);
    if (isFailure(value)) return value;
    const logged = log?.(value, context) ?? {};
    await recordAgentRead(
      tx,
      grant.access,
      {
        action,
        target: logged.target ?? null,
        details: { ...summarizeInput(input), ...logged.details },
      },
      now,
    );
    return value;
  });
}

// The target of a read of one note.
export function noteTarget(
  row: { id: string; title: string; folderId: string | null },
  index: FolderIndex,
): AuditTarget {
  return { kind: "note", id: row.id, label: joinPath(index.pathOf(row.folderId), row.title) };
}

export async function findNote(context: ReadContext, note: NoteRef): Promise<NoteRow | Failure> {
  const id = await resolveNoteRef(context.tx, context.grant, context.index, note);
  if (isFailure(id)) return id;
  return (await readLiveNote(context.tx, id)) ?? refuse("not_found");
}
