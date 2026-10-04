"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/checkbox/Checkbox";
import { FieldFrame, fieldA11yProps } from "@/components/field/FieldFrame";
import selectStyles from "@/components/language-select/LanguageSelect.module.css";
import type { FolderChoice } from "@/lib/api-tokens/folders";
import { GroupSlot, groupDescribedBy } from "./GroupSlot";
import styles from "./Tokens.module.css";

const MODE_ID = "token-scope";
const FOLDERS_ID = "token-folders";

export interface ScopeFieldsProps {
  folders: FolderChoice[];
  scoped: boolean;
  selected: string[];
  error?: string;
  onScopedChange(scoped: boolean): void;
  onSelectedChange(selected: string[]): void;
}

// Whole wiki (the default) or selected folders with their subfolders. A
// wiki without folders offers nothing to choose: the token covers the
// whole wiki, and the form says so without a control.
export function ScopeFields(props: ScopeFieldsProps) {
  const { folders, scoped, selected, error } = props;
  const t = useTranslations("tokens.form.scope");
  if (folders.length === 0) {
    return (
      <div className={styles.group}>
        <p className={styles.legend}>{t("label")}</p>
        <p className={styles.muted}>{t("wholeWiki")}</p>
      </div>
    );
  }
  return (
    <>
      <FieldFrame id={MODE_ID} label={t("label")} hint={t("hint")}>
        <select
          className={selectStyles.select}
          value={scoped ? "folders" : "wiki"}
          onChange={(event) => props.onScopedChange(event.currentTarget.value === "folders")}
          {...fieldA11yProps(MODE_ID, t("hint"), undefined)}
        >
          <option value="wiki">{t("wholeWiki")}</option>
          <option value="folders">{t("folders")}</option>
        </select>
      </FieldFrame>
      {scoped ? (
        <fieldset
          id={FOLDERS_ID}
          className={styles.group}
          aria-describedby={groupDescribedBy(FOLDERS_ID, undefined, error)}
        >
          <legend className={styles.legend}>{t("foldersLegend")}</legend>
          <div className={styles.folders}>
            {folders.map((folder) => (
              <Checkbox
                key={folder.id}
                name="folders"
                value={folder.id}
                label={<span className={styles.folderPath}>{folder.path}</span>}
                checked={selected.includes(folder.id)}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  props.onSelectedChange(
                    on ? [...selected, folder.id] : selected.filter((id) => id !== folder.id),
                  );
                }}
              />
            ))}
          </div>
          <GroupSlot id={FOLDERS_ID} error={error} reserve={[t("foldersMissing")]} />
        </fieldset>
      ) : null}
    </>
  );
}
