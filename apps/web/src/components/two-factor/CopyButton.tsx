"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import { toast } from "@/components/toast/toast-store";

export interface CopyButtonProps {
  text: string;
  label: string;
  // What was copied, for the confirmation toast ("Key copied").
  copiedTitle: string;
}

// Copies `text` to the clipboard and confirms with a success toast. The
// clipboard needs a secure context; elsewhere the toast asks to select and
// copy by hand (the text is shown next to the button and selectable).
export function CopyButton({ text, label, copiedTitle }: CopyButtonProps) {
  const t = useTranslations("twoFactor.copy");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success({ title: copiedTitle });
    } catch {
      toast.warning({ title: t("failedTitle"), message: t("failedDetail") });
    }
  }

  return (
    <Button variant="secondary" onClick={copy}>
      {label}
    </Button>
  );
}
