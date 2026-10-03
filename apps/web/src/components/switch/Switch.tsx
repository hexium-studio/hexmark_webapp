import type { ComponentProps, ReactNode } from "react";
import styles from "./Switch.module.css";

export interface SwitchProps
  extends Omit<ComponentProps<"input">, "type" | "role" | "className" | "checked"> {
  id: string;
  // Controlled: the caller keeps the state.
  checked: boolean;
  label: ReactNode;
  // Below the label; linked with aria-describedby.
  hint?: ReactNode;
}

// An on/off setting: a native checkbox with the switch role (announced as
// "switch, on/off"), drawn as a track with a knob. The knob moves by
// repainting the background, never by a transform, so no compositing layer
// appears. Label and hint sit beside it; the whole label toggles it.
export function Switch({ id, label, hint, checked, ...rest }: SwitchProps) {
  return (
    <div className={styles.row}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        // The native state is what browsers announce; stated for tools that
        // look for the attribute.
        aria-checked={checked === true}
        className={styles.switch}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
      />
      <div className={styles.text}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {hint ? (
          <div id={`${id}-hint`} className={styles.hint}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
