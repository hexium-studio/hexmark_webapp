"use client";

import type { NotePermission, UserRole } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { offeredPermissions } from "@/lib/api-tokens/offered-permissions";
import { type PickerTree, withLoadedFolder } from "@/lib/api-tokens/tree";
import { EntryList } from "./EntryList";
import { ModeFields } from "./ModeFields";
import { PermissionFields } from "./PermissionFields";
import { type PickedTarget, TargetTree, targetKey } from "./TargetTree";
import { loadTreeFolder } from "./token-actions";
import type { AccessDraft, DraftEntry } from "./token-draft";
import type { FormErrors } from "./use-token-form";

export const BASE_ID = "token-base-permissions";

export interface AccessFieldsProps {
  role: UserRole;
  tree: PickerTree;
  access: AccessDraft;
  errors: FormErrors;
  set: {
    mode(mode: NonNullable<AccessDraft["mode"]>): void;
    basePermissions(value: NotePermission[]): void;
    target(target: PickedTarget, on: boolean): void;
    entryPermissions(entry: DraftEntry, permissions: NotePermission[]): void;
  };
}

// What a token can reach: the mode first; then for a deny list its one set
// of permissions, and for both the targets, picked from the wiki's tree at
// any depth and listed below it (with permissions per entry on an allow
// list).
export function AccessFields({ role, access, errors, set, ...props }: AccessFieldsProps) {
  const t = useTranslations("tokens.form");
  const [tree, setTree] = useState(props.tree);
  const selected = new Set(access.entries.map((entry) => targetKey(entry.kind, entry.id)));
  const hint = role === "guest" ? t("permissions.guestHint") : t("permissions.hint");
  async function load(folderId: string) {
    const contents = await loadTreeFolder(folderId);
    if (contents) setTree((current) => withLoadedFolder(current, folderId, contents));
  }
  const { mode } = access;
  return (
    <>
      <ModeFields value={mode} error={errors.mode} onChange={set.mode} />
      {mode === "deny_list" ? (
        <PermissionFields
          id={BASE_ID}
          legend={t("access.baseLegend")}
          offered={offeredPermissions(role)}
          value={access.basePermissions}
          hint={hint}
          error={errors.basePermissions}
          reserve={[t("access.permissionsMissing")]}
          onChange={set.basePermissions}
        />
      ) : null}
      {mode ? (
        <>
          <TargetTree
            id="token-tree"
            legend={mode === "allow_list" ? t("access.treeAllow") : t("access.treeDeny")}
            hint={t("access.treeHint")}
            tree={tree}
            selected={selected}
            onToggle={set.target}
            onLoad={load}
          />
          <EntryList
            mode={mode}
            role={role}
            entries={access.entries}
            error={errors.entries}
            reserve={[
              t("access.entriesMissing"),
              t("access.entryPermissionsMissing"),
              t("access.entriesRefused"),
            ]}
            onPermissions={set.entryPermissions}
            onRemove={(entry) => set.target(entry, false)}
          />
        </>
      ) : null}
    </>
  );
}
