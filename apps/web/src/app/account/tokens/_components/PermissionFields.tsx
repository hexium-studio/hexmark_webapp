"use client";

import { NOTE_PERMISSIONS, type NotePermission } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/checkbox/Checkbox";
import { GroupSlot, groupDescribedBy } from "./GroupSlot";
import styles from "./Tokens.module.css";

export interface PermissionFieldsProps {
  // Id of the group; the boxes are found under it.
  id: string;
  legend: string;
  // The permissions that can be given here (role, kind of target).
  offered: readonly NotePermission[];
  value: NotePermission[];
  hint?: string;
  error?: string;
  // Errors the group may show later, kept invisibly so nothing moves.
  reserve: readonly string[];
  onChange(value: NotePermission[]): void;
}

// One checkbox per permission that can be given; what cannot is not offered
// (the server would refuse it).
export function PermissionFields(props: PermissionFieldsProps) {
  const { id, offered, value, hint, error } = props;
  const t = useTranslations("tokens");
  function toggle(permission: NotePermission, on: boolean) {
    const next = on ? [...value, permission] : value.filter((entry) => entry !== permission);
    props.onChange(NOTE_PERMISSIONS.filter((entry) => next.includes(entry)));
  }
  return (
    <fieldset id={id} className={styles.group} aria-describedby={groupDescribedBy(id, hint, error)}>
      <legend className={styles.legend}>{props.legend}</legend>
      <div className={styles.choices}>
        {offered.map((permission) => (
          <Checkbox
            key={permission}
            name={`${id}-permissions`}
            value={permission}
            label={t(`permissions.${permission}`)}
            checked={value.includes(permission)}
            onChange={(event) => toggle(permission, event.currentTarget.checked)}
          />
        ))}
      </div>
      <GroupSlot id={id} hint={hint} error={error} reserve={props.reserve} />
    </fieldset>
  );
}
