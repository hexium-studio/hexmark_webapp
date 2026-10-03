"use client";

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_GROUPS,
  RECOVERY_CODE_LENGTH,
} from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { type ClipboardEvent, Fragment, type KeyboardEvent, type Ref, useRef } from "react";
import { acceptedChars, type CodeRules, insertChars } from "@/components/code-input/code-model";
import fieldStyles from "@/components/field/Field.module.css";
import styles from "./RecoveryCodeInput.module.css";

// The rules of a recovery code's characters (packages/shared/src/recovery-code.ts):
// lower case is upper-cased, and only the unambiguous alphabet is kept, so
// spaces, dashes and look-alikes such as 0, O, 1 and I are dropped.
export const RECOVERY_CODE_RULES: CodeRules = {
  length: RECOVERY_CODE_LENGTH,
  allowed: (char) => RECOVERY_CODE_ALPHABET.includes(char),
  normalise: (char) => char.toUpperCase(),
};

const GROUPS = Array.from({ length: RECOVERY_CODE_GROUPS }, (_, index) => index);

export interface RecoveryCodeInputProps {
  id: string;
  // One entry per character, "" for empty (code-model.ts).
  value: readonly string[];
  onValueChange(next: string[]): void;
  // Marks the groups red without a text (the toast explains it).
  invalid: boolean;
  firstRef?: Ref<HTMLInputElement>;
}

// A recovery code as three framed groups of four characters in one row
// ("ABCD – EFGH – JKLM"), each group one input. Typing moves on to the next
// group when one is full, Backspace in an empty group goes back, and a
// pasted code (with or without dashes) fills the groups from where it was
// pasted; a complete code fills all of them.
export function RecoveryCodeInput({
  id,
  value,
  onValueChange,
  invalid,
  firstRef,
}: RecoveryCodeInputProps) {
  const t = useTranslations("secondFactor.recovery");
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const size = RECOVERY_CODE_GROUP_LENGTH;
  const groupText = (group: number) => value.slice(group * size, (group + 1) * size).join("");

  // Focus with the caret after the group's characters.
  function focusGroup(group: number) {
    const input = inputs.current[Math.min(Math.max(group, 0), GROUPS.length - 1)];
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }

  function place(group: number, text: string) {
    const chars = acceptedChars(text, RECOVERY_CODE_RULES);
    const cleared = [...value];
    for (let index = group * size; index < (group + 1) * size; index += 1) cleared[index] = "";
    const result = insertChars(cleared, group * size, chars);
    onValueChange(result.code);
    const filled = group * size + chars.length;
    if (chars.length >= size && filled < RECOVERY_CODE_LENGTH) {
      focusGroup(Math.floor(filled / size));
    }
  }

  function onPaste(group: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const chars = acceptedChars(event.clipboardData.getData("text"), RECOVERY_CODE_RULES);
    if (chars.length === 0) return;
    const start = chars.length === RECOVERY_CODE_LENGTH ? 0 : group * size;
    const result = insertChars(value, start, chars);
    onValueChange(result.code);
    focusGroup(Math.floor(result.focusIndex / size));
  }

  function onKeyDown(group: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && event.currentTarget.value === "" && group > 0) {
      event.preventDefault();
      focusGroup(group - 1);
    }
  }

  return (
    <div className={styles.row} data-invalid={invalid || undefined}>
      {GROUPS.map((group) => (
        <Fragment key={group}>
          {group > 0 ? (
            <span className={styles.dash} aria-hidden="true">
              –
            </span>
          ) : null}
          <input
            ref={(element) => {
              inputs.current[group] = element;
              if (group === 0 && firstRef) {
                if (typeof firstRef === "function") firstRef(element);
                else firstRef.current = element;
              }
            }}
            id={`${id}-${group + 1}`}
            type="text"
            className={`${fieldStyles.input} ${styles.group}`}
            value={groupText(group)}
            aria-label={t("group", { position: group + 1, total: GROUPS.length })}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-hint`}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            onChange={(event) => place(group, event.currentTarget.value)}
            onPaste={(event) => onPaste(group, event)}
            onKeyDown={(event) => onKeyDown(group, event)}
          />
        </Fragment>
      ))}
    </div>
  );
}
