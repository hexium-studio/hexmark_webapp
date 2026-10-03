"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import { ButtonLink } from "@/components/button/ButtonLink";
import { FormAlert } from "@/components/form-alert/FormAlert";

// Steps 5 and 6 without a usable setup ticket. "expired": its 15 minutes
// are over (or it was used up); the admin account exists, so setup is
// finished on the completion page and the rest is done after signing in.
// "unavailable": the server did not answer; try again.
export function TicketProblem({ kind }: { kind: "expired" | "unavailable" }) {
  const t = useTranslations("setup.ticket");
  const router = useRouter();
  if (kind === "unavailable") {
    return (
      <FormAlert
        title={t("unavailable.title")}
        actions={<Button onClick={() => router.refresh()}>{t("unavailable.retry")}</Button>}
      >
        <p>{t("unavailable.detail")}</p>
      </FormAlert>
    );
  }
  return (
    <FormAlert
      title={t("expired.title")}
      actions={<ButtonLink href="/setup/complete">{t("expired.continue")}</ButtonLink>}
    >
      <p>{t("expired.detail")}</p>
      <p>{t("expired.later")}</p>
    </FormAlert>
  );
}
