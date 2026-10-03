"use client";

import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, type Ref, useImperativeHandle, useState } from "react";
import fieldStyles from "../field/Field.module.css";
import { FieldError } from "../field/FieldError";
import cellStyles from "./CodeCells.module.css";
import styles from "./CodeInput.module.css";
import type { CodeRules, CodeValue } from "./code-model";
import { useCodeCells } from "./use-code-cells";

// A code entered one character per cell (setup token, later TOTP), in
// groups. Screen readers get each cell as "Character 3 of 8" plus a
// description "entered" or "empty"; a masked cell shows an asterisk that is
// drawn beside the input (aria-hidden), never put into its value, so it is
// not read out as "star" and the real character is not in the DOM.
// Each group is one frame with dividers between its
// cells; a dash between groups is decoration only (aria-hidden).

export interface CodeInputHandle {
  focus(index?: number): void;
}

export interface CodeInputProps extends CodeRules {
  id: string;
  legend: string;
  hint?: ReactNode;
  error?: string;
  // Marks the cells invalid without a message of their own, for a value
  // rejected elsewhere (e.g. a wrong token, explained by an error toast).
  // `error` implies it.
  invalid?: boolean;
  value: CodeValue;
  onValueChange(next: string[]): void;
  groupSize?: number;
  // Set (true or false) to mask the code and offer a Show/Hide button;
  // the value is the initial state. Leave out for codes shown in clear.
  defaultMasked?: boolean;
  // Completes the Show/Hide toggle's accessible name: "Show" + " setup token".
  toggleSubject?: string;
  inputMode?: "text" | "numeric";
  // For the first cell, e.g. "one-time-code"; the others are always "off".
  autoComplete?: string;
  ref?: Ref<CodeInputHandle>;
}

function cellGroups(length: number, size: number): number[][] {
  const indexes = Array.from({ length }, (_, index) => index);
  const groups: number[][] = [];
  for (let start = 0; start < length; start += size) {
    groups.push(indexes.slice(start, start + size));
  }
  return groups;
}

export function CodeInput(props: CodeInputProps) {
  const { id, legend, hint, error, value, length, groupSize = length } = props;
  const invalid = props.invalid === true || error !== undefined;
  const t = useTranslations("codeInput");
  const tField = useTranslations("field");
  const maskable = props.defaultMasked !== undefined;
  const [masked, setMasked] = useState(props.defaultMasked ?? false);
  const cells = useCodeCells({ value, onValueChange: props.onValueChange, rules: props, masked });
  useImperativeHandle(props.ref, () => ({ focus: (index = 0) => cells.focusCell(index) }));

  const ids = {
    hint: `${id}-hint`,
    error: `${id}-error`,
    filled: `${id}-filled`,
    empty: `${id}-empty`,
  };
  const groupDescription = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean);

  return (
    // The wrapper is the size container the layout of the fieldset follows.
    <div className={styles.root}>
      <fieldset
        id={id}
        className={styles.fieldset}
        aria-describedby={groupDescription.join(" ") || undefined}
      >
        <legend className={`${fieldStyles.label} ${styles.legend}`}>{legend}</legend>
        {hint ? (
          <p id={ids.hint} className={`${fieldStyles.hint} ${styles.hint}`}>
            {hint}
          </p>
        ) : null}
        {maskable ? (
          <button
            type="button"
            className={`${fieldStyles.toggle} ${styles.toggle}`}
            aria-controls={id}
            onClick={() => setMasked((current) => !current)}
          >
            {tField(masked ? "show" : "hide")}
            {props.toggleSubject ? (
              <span className="visually-hidden">
                {tField("toggleSuffix", { subject: props.toggleSubject })}
              </span>
            ) : null}
          </button>
        ) : null}
        <div
          className={`${styles.cellsArea} ${cellStyles.groups}`}
          data-invalid={invalid || undefined}
        >
          {cellGroups(length, groupSize).map((group, groupIndex) => (
            <Fragment key={group[0]}>
              {groupIndex > 0 ? (
                // Every second dash starts a new row when two groups share a row.
                <span
                  className={`${cellStyles.separator} ${groupIndex % 2 === 0 ? cellStyles.pairStart : ""}`}
                  aria-hidden="true"
                >
                  –
                </span>
              ) : null}
              <div className={cellStyles.group}>
                {group.map((index) => {
                  const filled = (value[index] ?? "") !== "";
                  const glyph = masked && filled && cells.draftIndex !== index;
                  const describedBy = [filled ? ids.filled : ids.empty, error ? ids.error : null];
                  return (
                    <span key={index} className={cellStyles.cell}>
                      {glyph ? (
                        <span className={cellStyles.glyph} aria-hidden="true">
                          *
                        </span>
                      ) : null}
                      <input
                        ref={(element) => {
                          cells.inputs.current[index] = element;
                        }}
                        id={`${id}-${index + 1}`}
                        type="text"
                        className={cellStyles.input}
                        value={cells.shownValue(index)}
                        aria-label={t("cell", { position: index + 1, length })}
                        aria-describedby={describedBy.filter(Boolean).join(" ")}
                        aria-invalid={invalid || undefined}
                        data-glyph={glyph || undefined}
                        autoComplete={index === 0 ? (props.autoComplete ?? "off") : "off"}
                        inputMode={props.inputMode ?? "text"}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        // Password managers would offer to fill or save these.
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                        data-form-type="other"
                        onChange={(event) => cells.handlers.onChange(index, event)}
                        onKeyDown={(event) => cells.handlers.onKeyDown(index, event)}
                        onPaste={(event) => cells.handlers.onPaste(index, event)}
                        onCompositionStart={() => cells.handlers.onCompositionStart(index)}
                        onCompositionEnd={(event) => cells.handlers.onCompositionEnd(index, event)}
                        // Typing then replaces a shown character instead of adding to it.
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </span>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
        {error ? (
          <div className={styles.error}>
            <FieldError id={ids.error} message={error} />
          </div>
        ) : null}
        {/* Descriptions of the cells; `hidden` keeps them out of reading order,
          aria-describedby still reads hidden elements it points to. */}
        <span id={ids.filled} hidden>
          {t("filled")}
        </span>
        <span id={ids.empty} hidden>
          {t("empty")}
        </span>
      </fieldset>
    </div>
  );
}
