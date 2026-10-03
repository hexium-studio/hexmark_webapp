import QRCode from "qrcode";

// The QR code of an authenticator app set-up (otpauth:// URI), computed on
// the Next.js server with the `qrcode` package: no external service ever
// sees the secret. The result is the geometry of an SVG, which the page
// draws inline (components/two-factor/QrCode.tsx): one path of unit squares
// for the dark modules on a light square that includes the quiet zone.
// Error correction "M" keeps the code small; the URI is short.

export interface QrSvg {
  // viewBox of the SVG, quiet zone included: "0 0 <n> <n>".
  viewBox: string;
  // Edge length in modules, quiet zone included.
  size: number;
  // Path of the dark modules, one rectangle per horizontal run.
  path: string;
}

// Four modules of light margin on every side, as the standard asks.
export const QR_QUIET_ZONE = 4;

export function qrCodeSvg(text: string): QrSvg {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const runs: string[] = [];
  for (let row = 0; row < n; row += 1) {
    let col = 0;
    while (col < n) {
      if (!modules.data[row * n + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < n && modules.data[row * n + col]) col += 1;
      const x = start + QR_QUIET_ZONE;
      const y = row + QR_QUIET_ZONE;
      runs.push(`M${x} ${y}h${col - start}v1h-${col - start}z`);
    }
  }
  const size = n + 2 * QR_QUIET_ZONE;
  return { viewBox: `0 0 ${size} ${size}`, size, path: runs.join("") };
}
