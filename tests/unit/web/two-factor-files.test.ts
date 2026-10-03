import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE, qrCodeSvg } from "@/lib/two-factor/qr-code";
import { RECOVERY_CODES_FILENAME, recoveryCodesFile } from "@/lib/two-factor/recovery-file";

// The QR code of the authenticator set-up (computed on the server, drawn as
// inline SVG) and the downloaded recovery codes file.

// The package as the web app has it (a dependency of apps/web only), for
// the module matrix the drawing must match.
interface QrPackage {
  create(
    text: string,
    options: { errorCorrectionLevel: "M" },
  ): { modules: { size: number; data: Uint8Array } };
}
const QRCode = createRequire(new URL("../../../apps/web/package.json", import.meta.url))(
  "qrcode",
) as QrPackage;

const URI =
  "otpauth://totp/Hexmark:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Hexmark";

describe("qrCodeSvg", () => {
  const svg = qrCodeSvg(URI);
  const { modules } = QRCode.create(URI, { errorCorrectionLevel: "M" });

  it("frames the code with a quiet zone of four modules", () => {
    expect(svg.size).toBe(modules.size + 2 * QR_QUIET_ZONE);
    expect(svg.viewBox).toBe(`0 0 ${svg.size} ${svg.size}`);
  });

  it("draws exactly the dark modules, one rectangle per run", () => {
    const runs = svg.path.match(/M\d+ \d+h\d+v1h-\d+z/g) ?? [];
    expect(runs.join("")).toBe(svg.path);
    let area = 0;
    for (const run of runs) {
      const [, x, y, width] = /M(\d+) (\d+)h(\d+)/.exec(run) ?? [];
      const row = Number(y) - QR_QUIET_ZONE;
      const start = Number(x) - QR_QUIET_ZONE;
      for (let col = start; col < start + Number(width); col += 1) {
        expect(modules.data[row * modules.size + col]).toBe(1);
      }
      area += Number(width);
    }
    expect(area).toBe(modules.data.reduce((sum: number, bit: number) => sum + bit, 0));
  });

  it("starts with the finder pattern in the top-left corner", () => {
    expect(svg.path.startsWith(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h7v1h-7z`)).toBe(true);
  });

  it("contains nothing but path data (no markup from the input)", () => {
    expect(qrCodeSvg('"><script>alert(1)</script>').path).toMatch(/^[Mhvz\d -]+$/);
  });
});

describe("recoveryCodesFile", () => {
  const codes = ["ABCD-EFGH-JKLM", "NPQR-STUV-WXYZ"];

  it("puts a header, the notes and one code per line", () => {
    const text = recoveryCodesFile(codes, {
      title: "Hexmark recovery codes",
      account: "Account: ada",
      created: "Created: 3 October 2026 at 14:05",
      notes: ["Each code works once.", "Keep them safe."],
    });
    expect(text).toBe(
      [
        "Hexmark recovery codes",
        "Account: ada",
        "Created: 3 October 2026 at 14:05",
        "",
        "Each code works once.",
        "Keep them safe.",
        "",
        "ABCD-EFGH-JKLM",
        "NPQR-STUV-WXYZ",
        "",
      ].join("\n"),
    );
  });

  it("leaves out an empty account line", () => {
    const text = recoveryCodesFile(codes, { title: "T", created: "C", notes: [] });
    expect(text.split("\n").slice(0, 3)).toEqual(["T", "C", ""]);
  });

  it("is saved as hexmark-recovery-codes.txt", () => {
    expect(RECOVERY_CODES_FILENAME).toBe("hexmark-recovery-codes.txt");
  });
});
