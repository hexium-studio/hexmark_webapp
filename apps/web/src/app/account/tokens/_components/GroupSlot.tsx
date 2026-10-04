import fieldStyles from "@/components/field/Field.module.css";
import { FieldError } from "@/components/field/FieldError";

export interface GroupSlotProps {
  // Id of the group; the texts get "<id>-hint" and "<id>-error".
  id: string;
  hint?: string;
  error?: string;
  // Errors the group may show later, kept invisibly so nothing moves.
  reserve: readonly string[];
}

// The message slot under a group of checkboxes, built like a text field's
// (components/field/FieldFrame.tsx): hint, error and reserved texts share
// one grid cell, so the slot keeps its height whichever is shown.
export function GroupSlot({ id, hint, error, reserve }: GroupSlotProps) {
  return (
    <div className={fieldStyles.slot}>
      {hint ? (
        <p
          id={`${id}-hint`}
          className={`${fieldStyles.hint} ${error ? fieldStyles.concealed : ""}`}
        >
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${id}-error`} message={error} /> : null}
      {reserve
        .filter((text) => text !== error)
        .map((text) => (
          <div key={text} className={fieldStyles.concealed} aria-hidden="true">
            <FieldError message={text} />
          </div>
        ))}
    </div>
  );
}

// aria-describedby of the group: only what is visible.
export function groupDescribedBy(id: string, hint: string | undefined, error: string | undefined) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}
