import styles from "./Field.module.css";

// Error line under a field or a group of fields. The caller links `id`
// through aria-describedby so the message is read with the field.
export function FieldError({ id, message }: { id?: string; message: string }) {
  return (
    <p id={id} className={styles.error}>
      <svg className={styles.errorIcon} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 4.5v4.5M8 11v.5" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span>{message}</span>
    </p>
  );
}
