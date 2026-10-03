// The text file a user downloads with new recovery codes. Lines end in
// "\n"; the codes come one per line after a short header, in the language
// of the page (the caller passes the translated lines).

export const RECOVERY_CODES_FILENAME = "hexmark-recovery-codes.txt";

export interface RecoveryFileText {
  title: string;
  // e.g. "Account: ada@example.com"; left out when empty.
  account?: string;
  // e.g. "Created: 3 October 2026, 14:05"
  created: string;
  // How to use them, one or more lines.
  notes: readonly string[];
}

export function recoveryCodesFile(codes: readonly string[], text: RecoveryFileText): string {
  const header = [text.title, text.account, text.created].filter(
    (line): line is string => typeof line === "string" && line !== "",
  );
  return `${[...header, "", ...text.notes, "", ...codes].join("\n")}\n`;
}

// Hands the text to the browser as a download. Browser only.
export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has handed the file over.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
