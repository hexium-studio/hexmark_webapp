"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { toast } from "@/components/toast/toast-store";
import { signIn } from "./actions";
import { cancelHeadingFocus, requestHeadingFocus } from "./heading-focus";
import { RememberMe } from "./RememberMe";
import styles from "./SignIn.module.css";
import { SignInFields } from "./SignInFields";
import { readSignInValues, type SignInFieldName, validateSignIn } from "./sign-in-form";
import type { SignInErrorCode, SignInResult } from "./sign-in-result";
import { useSignInValidation } from "./use-sign-in-validation";

const SUBMIT_REASON_ID = "sign-in-submit-reason";

// Every refusal is a toast (UI guidelines); "setup_token_present" swaps the
// page for the blocked state. A validation answer cannot happen through this
// form (it sends only what the shared schema accepts), so it counts as
// unexpected.
type ToastCode = Exclude<SignInErrorCode, "validation" | "setup_token_present">;

// E-mail, password and "Remember me", without any field errors: "Sign in"
// stays disabled until the shared schema accepts e-mail and password; the
// reason is not shown (the empty form speaks for itself) but read with the
// button. On success the action sets the cookie and the page re-renders as
// home in the same request. A correct password of an account with a second
// factor (or one that must set up a factor) hands over to the next step
// (`onContinue`). A wrong e-mail or password keeps the e-mail, clears the
// password and focuses it.
export interface SignInFormProps {
  onContinue(result: Extract<SignInResult, { ok: true }>): void;
}

export function SignInForm({ onContinue }: SignInFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const validation = useSignInValidation();

  function field(name: SignInFieldName): HTMLInputElement | undefined {
    const element = formRef.current?.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element : undefined;
  }

  function showToast(code: ToastCode) {
    toast.error({ title: t(`errors.${code}.title`), message: t(`errors.${code}.detail`) });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const result = validateSignIn(readSignInValues(event.currentTarget));
    // The button is disabled then; Enter in a field must not send either.
    if (!result.ok) return;
    requestHeadingFocus();
    startTransition(async () => {
      const outcome = await signIn(result.input);
      if (outcome.ok && outcome.next === "signed_in") return;
      cancelHeadingFocus();
      if (outcome.ok) return onContinue(outcome);
      if (outcome.error === "setup_token_present") return router.refresh();
      showToast(outcome.error === "validation" ? "unexpected" : outcome.error);
      if (outcome.error === "invalid_credentials") {
        const password = field("password");
        if (password) {
          password.value = "";
          if (formRef.current) validation.revalidate(formRef.current);
          password.focus();
        }
      }
    });
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      onSubmit={handleSubmit}
      // Autofill may fill fields without a change event until the page is
      // touched; checking again on focus enables the button then.
      onFocus={(event) => validation.revalidate(event.currentTarget)}
      onChange={(event) => validation.revalidate(event.currentTarget)}
    >
      <SignInFields />
      <RememberMe />
      <div className={styles.actions}>
        <Button
          type="submit"
          className={styles.submit}
          disabled={validation.blocked}
          pending={isPending}
          aria-describedby={validation.blocked ? SUBMIT_REASON_ID : undefined}
        >
          {isPending ? t("submitting") : t("submit")}
        </Button>
        {validation.blocked ? (
          <span id={SUBMIT_REASON_ID} className="visually-hidden">
            {t("submitDisabledReason")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
