"use client";

import { NOTE_PERMISSIONS, type NotePermission, type UserRole } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/checkbox/Checkbox";
import { offeredPermissions } from "@/lib/api-tokens/offered-permissions";
import { GroupSlot, groupDescribedBy } from "./GroupSlot";
import styles from "./Tokens.module.css";

const ID = "token-permissions";

export interface PermissionFieldsProps {
  role: UserRole;
  value: NotePermission[];
  error?: string;
  onChange(value: NotePermission[]): void;
}

// One checkbox per permission the account's role can give; what it cannot
// give is not offered (the server would refuse it).
export function PermissionFields({ role, value, error, onChange }: PermissionFieldsProps) {
  const t = useTranslations("tokens");
  const offered = offeredPermissions(role);
  const hint = role === "guest" ? t("form.permissions.guestHint") : t("form.permissions.hint");
  function toggle(permission: NotePermission, on: boolean) {
    const next = on ? [...value, permission] : value.filter((entry) => entry !== permission);
    onChange(NOTE_PERMISSIONS.filter((entry) => next.includes(entry)));
  }
  return (
    <fieldset id={ID} className={styles.group} aria-describedby={groupDescribedBy(ID, hint, error)}>
      <legend className={styles.legend}>{t("form.permissions.legend")}</legend>
      <div className={styles.choices}>
        {offered.map((permission) => (
          <Checkbox
            key={permission}
            name="permissions"
            value={permission}
            label={t(`permissions.${permission}`)}
            checked={value.includes(permission)}
            onChange={(event) => toggle(permission, event.currentTarget.checked)}
          />
        ))}
      </div>
      <GroupSlot id={ID} hint={hint} error={error} reserve={[t("form.permissions.missing")]} />
    </fieldset>
  );
}
