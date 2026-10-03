"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/button/Button";
import { toast } from "@/components/toast/toast-store";
import { signOut } from "./actions";
import { requestHeadingFocus } from "./heading-focus";

// Ends the session. The action deletes the cookie, so the page re-renders as
// the sign-in form in the same request; the toast confirms it there (the
// store outlives this button). If the server could not confirm, the toast
// says that the session was only ended on this device.
export function SignOutButton() {
  const t = useTranslations("home");
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending) return;
    requestHeadingFocus();
    startTransition(async () => {
      const { confirmed } = await signOut();
      if (confirmed) {
        toast.success({ title: t("signedOut.title"), message: t("signedOut.message") });
      } else {
        toast.warning({
          title: t("signedOutLocally.title"),
          message: t("signedOutLocally.message"),
        });
      }
    });
  }

  return (
    <Button variant="secondary" pending={isPending} onClick={handleClick}>
      {isPending ? t("signingOut") : t("signOut")}
    </Button>
  );
}
