import type { QrSvg } from "@/lib/two-factor/qr-code";
import styles from "./TotpSetup.module.css";

// The QR code computed on the server (lib/two-factor/qr-code.ts), drawn
// inline: dark modules on white with the quiet zone, in both themes, since
// scanners need dark on light. Without a code yet, the same box stays empty
// so nothing around it moves when it arrives.
export function QrCode({ qr, label }: { qr: QrSvg | undefined; label: string }) {
  if (!qr) return <div className={styles.qr} aria-hidden="true" />;
  return (
    <svg
      className={styles.qr}
      viewBox={qr.viewBox}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#09090b" />
    </svg>
  );
}
