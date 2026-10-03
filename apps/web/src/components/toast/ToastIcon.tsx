import type { ToastType } from "./toast-store";

// One symbol per type, so the meaning never rests on colour alone. Drawn in
// currentColor (the type colour); decorative, the visually hidden prefix
// ("Error:") names the type for screen readers.
export function ToastIcon({ type, className }: { type: ToastType; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === "warning" ? (
        <>
          <path d="M10 2.75 1.75 17.25h16.5Z" />
          <path d="M10 8v4M10 14.5v.01" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8" />
      )}
      {type === "success" ? <path d="m6.5 10.25 2.5 2.5 4.5-5" /> : null}
      {type === "info" ? <path d="M10 9v5M10 6v.01" /> : null}
      {type === "error" ? <path d="m7.25 7.25 5.5 5.5M12.75 7.25l-5.5 5.5" /> : null}
    </svg>
  );
}

// The "x" of the close button, also decorative (the button has a name).
export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
