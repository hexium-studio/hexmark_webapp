// Circled status symbol in the current text colour. Always decorative: the
// state is spelled out in text next to it.

export type StatusIconKind = "pass" | "fail" | "unknown";

export interface StatusIconProps {
  kind: StatusIconKind;
  className?: string;
}

export function StatusIcon({ kind, className }: StatusIconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      {kind === "pass" ? (
        <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : null}
      {kind === "fail" ? (
        <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : null}
      {kind === "unknown" ? <path d="M6.5 10h7" stroke="currentColor" strokeWidth="2" /> : null}
    </svg>
  );
}
