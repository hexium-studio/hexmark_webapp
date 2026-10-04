import type { NotePermission, TreeResponse } from "@hexmark/shared";
import { and, count, isNull } from "drizzle-orm";
import { OVERVIEW_DEPTH } from "../../config/notes";
import { notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { visibleFolderSql } from "../access/authorize";
import { withRead } from "./read-frame";
import { buildTree } from "./tree";

// What an agent sees first: who it acts as, what it may do, the top of the
// folder tree and how much there is.

export interface Overview {
  instance: { name: string };
  access: {
    kind: "session" | "token";
    actorName: string;
    permissions: NotePermission[];
    // Null: the whole wiki.
    folderScope: { id: string; path: string }[] | null;
  };
  tree: TreeResponse;
  treeDepth: number;
  counts: { notes: number; folders: number };
}

// The product name; an instance name setting does not exist yet.
const INSTANCE_NAME = "Hexmark";

export function readOverview(ref: AccessRef, now: Date): Promise<Outcome<Overview>> {
  const request = { ref, now, permission: "read", action: "read.overview" } as const;
  return withRead(
    request,
    async (context) => {
      const { tx, grant, index } = context;
      const [noteCount] = await tx
        .select({ value: count() })
        .from(notes)
        .where(and(isNull(notes.deletedAt), visibleFolderSql(grant, notes.folderId)));
      const folderCount = grant.scope === null ? index.size : grant.scope.size;
      const { access } = grant;
      return {
        instance: { name: INSTANCE_NAME },
        access: {
          kind: access.ref.kind,
          actorName: access.actor.name,
          permissions: access.permissions,
          folderScope: access.folderScope?.map((id) => ({ id, path: index.pathOf(id) })) ?? null,
        },
        tree: await buildTree(context, null, OVERVIEW_DEPTH),
        treeDepth: OVERVIEW_DEPTH,
        counts: { notes: noteCount?.value ?? 0, folders: folderCount },
      };
    },
    (overview) => ({ details: { ...overview.counts } }),
  );
}
