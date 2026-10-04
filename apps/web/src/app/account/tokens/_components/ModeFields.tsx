"use client";

import { API_TOKEN_ACCESS_MODES, type ApiTokenAccessMode } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import access from "./Access.module.css";
import { GroupSlot, groupDescribedBy } from "./GroupSlot";
import styles from "./Tokens.module.css";

export const MODE_ID = "token-mode";

export interface ModeFieldsProps {
  value: ApiTokenAccessMode | null;
  error?: string;
  onChange(mode: ApiTokenAccessMode): void;
}

// The two access modes as radio buttons, none chosen at first: each says in
// one sentence what happens with notes and folders created later.
export function ModeFields({ value, error, onChange }: ModeFieldsProps) {
  const t = useTranslations("tokens.form.access");
  const hint = t("modeHint");
  return (
    <fieldset
      id={MODE_ID}
      className={styles.group}
      aria-describedby={groupDescribedBy(MODE_ID, hint, error)}
    >
      <legend className={styles.legend}>{t("modeLegend")}</legend>
      <div className={access.modes}>
        {API_TOKEN_ACCESS_MODES.map((mode) => (
          <label key={mode} className={access.mode}>
            <input
              type="radio"
              name="mode"
              value={mode}
              className={access.radio}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            <span className={access.modeText}>
              <span className={access.modeLabel}>{t(`${mode}.label`)}</span>
              <span className={styles.muted}>{t(`${mode}.detail`)}</span>
            </span>
          </label>
        ))}
      </div>
      <GroupSlot id={MODE_ID} hint={hint} error={error} reserve={[t("modeMissing")]} />
    </fieldset>
  );
}
