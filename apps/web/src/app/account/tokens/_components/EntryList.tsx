"use client";

import type { ApiTokenAccessMode, NotePermission, UserRole } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import { offeredPermissions } from "@/lib/api-tokens/offered-permissions";
import access from "./Access.module.css";
import { GroupSlot } from "./GroupSlot";
import { PermissionFields } from "./PermissionFields";
import styles from "./Tokens.module.css";
import type { DraftEntry } from "./token-draft";

export const ENTRIES_ID = "token-entries";

export interface EntryListProps {
  mode: ApiTokenAccessMode;
  role: UserRole;
  entries: DraftEntry[];
  error?: string;
  reserve: readonly string[];
  onPermissions(entry: DraftEntry, permissions: NotePermission[]): void;
  onRemove(entry: DraftEntry): void;
}

// The chosen targets, by path. On an allow list each has its own
// permissions (a single note: no create or search); on a deny list they are
// only what the token cannot reach. A target in the trash is marked: its
// entry stays and applies again when it is restored.
export function EntryList(props: EntryListProps) {
  const { mode, entries } = props;
  const t = useTranslations("tokens.form.access");
  const tKind = useTranslations("tokens.kinds");
  const legend = mode === "allow_list" ? t("allowedLegend") : t("excludedLegend");
  return (
    <section id={ENTRIES_ID} className={styles.group} aria-label={legend}>
      <p className={styles.legend}>{legend}</p>
      {entries.length === 0 ? (
        <p className={styles.muted}>
          {mode === "allow_list" ? t("noneAllowed") : t("noneExcluded")}
        </p>
      ) : (
        <ul className={access.entries}>
          {entries.map((entry, index) => (
            <li key={`${entry.kind}:${entry.id}`} className={access.entry}>
              <p className={access.entryPath}>
                <span className={access.entryKind}>{tKind(entry.kind)}</span> {entry.path}
                {entry.trashed ? <span className={styles.muted}> ({t("inTrash")})</span> : null}
              </p>
              {mode === "allow_list" ? (
                <PermissionFields
                  id={`token-entry-${index}`}
                  legend={t("entryPermissions", { path: entry.path })}
                  offered={offeredPermissions(props.role, entry.kind)}
                  value={entry.permissions}
                  reserve={[]}
                  onChange={(permissions) => props.onPermissions(entry, permissions)}
                />
              ) : null}
              <div>
                <Button variant="secondary" onClick={() => props.onRemove(entry)}>
                  {t("remove")}
                  <span className="visually-hidden"> {entry.path}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <GroupSlot id={ENTRIES_ID} error={props.error} reserve={props.reserve} />
    </section>
  );
}
