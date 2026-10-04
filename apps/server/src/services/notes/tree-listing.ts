import type { TreeResponse } from "@hexmark/shared";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { folderRefusal } from "../access/authorize";
import { hiddenRefusal } from "../hidden/hidden-state";
import { isAgent } from "../locks/lock-guard";
import { missingFolder } from "../trash/in-trash";
import { withRead } from "./read-frame";
import { buildTree } from "./tree";

// Listing a folder (or the root level) as a tree (tree.ts). A folder that
// is hidden itself cannot be listed by an agent: what lies below it does not
// exist for it, so the answer is hidden, naming the folder.

export function listTree(
  ref: AccessRef,
  now: Date,
  input: { folderId: string | null; depth: number },
): Promise<Outcome<TreeResponse>> {
  const request = { ref, now, permission: "read", action: "read.folder", input } as const;
  return withRead(
    request,
    async (context) => {
      if (input.folderId !== null) {
        const known = context.index.get(input.folderId);
        if (!known) return missingFolder(context.tx, context.grant, input.folderId);
        const refused = folderRefusal(context.grant.view, known.id, "read");
        if (refused) return refused;
        if (known.hidden && isAgent(context.grant)) {
          const path = context.index.pathOf(known.id);
          return hiddenRefusal({ kind: "folder", id: known.id, path }, known.hidden);
        }
      }
      return buildTree(context, input.folderId, input.depth);
    },
    (tree) => ({
      target: tree.folder ? { kind: "folder", id: tree.folder.id, label: tree.folder.path } : null,
      details: { folderCount: tree.folders.length, noteCount: tree.notes.length },
    }),
  );
}
