"use client";

import {
  type FieldError,
  fieldErrorsFromZod,
  SETUP_TOKEN_LENGTH,
  setupTokenSchema,
} from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { CodeInput, type CodeInputHandle } from "@/components/code-input/CodeInput";
import { codeFromText, filledCount } from "@/components/code-input/code-model";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { verifySetupToken } from "./actions";
import styles from "./Step.module.css";
import { useSetupErrorToast } from "./setup-errors";
import { SETUP_TOKEN_RULES } from "./setup-token-rules";
import type { StepProps } from "./wizard-types";

const FIELD_ID = "setup-token";
const PROGRESS_ID = "setup-token-progress";

// The admin proves access to the server by entering SETUP_TOKEN.
// A token that breaks the format rule is a field error, shown under the
// cells (kept as a code, so it follows a language change). Everything else
// is an error toast: a wrong token (the cells keep their content, are marked
// invalid without a text of their own until the next edit, and focus goes
// to the first one), too many attempts, server problems (with a way back to
// the connection check) and a setup that is already closed (the page then
// reloads into its 404; the toast stays, see Toaster). Only a wrong token
// marks the cells: the other toasts are not about what was entered.
export function TokenStep({ wizard }: StepProps) {
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");
  const fieldErrorText = useFieldErrorText();
  const router = useRouter();
  const codeRef = useRef<CodeInputHandle>(null);
  const [code, setCode] = useState(() => codeFromText(wizard.data.setupToken, SETUP_TOKEN_RULES));
  const [fieldError, setFieldError] = useState<FieldError>();
  // The server (or the schema, without a field error) rejected the entered token.
  const [rejected, setRejected] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const showError = useSetupErrorToast(wizard);
  const [isPending, startTransition] = useTransition();
  const entered = filledCount(code);
  const complete = entered === SETUP_TOKEN_LENGTH;

  // Focus the first cell after a field error is rendered, so screen
  // readers read the message with the cell.
  useEffect(() => {
    if (focusRequest > 0) codeRef.current?.focus(0);
  }, [focusRequest]);

  function showFieldError(error: FieldError | undefined) {
    setFieldError(error);
    setFocusRequest((count) => count + 1);
  }

  function showWrongToken() {
    showError("wrong_token");
    setRejected(true);
    showFieldError(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !complete) return;
    const parsed = setupTokenSchema.safeParse(code.join(""));
    if (!parsed.success) {
      const [error] = Object.values(fieldErrorsFromZod(parsed.error));
      return error ? showFieldError(error) : showWrongToken();
    }
    setFieldError(undefined);
    startTransition(async () => {
      const result = await verifySetupToken(parsed.data);
      if (result.ok) {
        wizard.update({ setupToken: parsed.data });
        wizard.next();
        return;
      }
      if (result.error === "validation" && result.fields.setupToken) {
        return showFieldError(result.fields.setupToken);
      }
      if (result.error === "invalid_token") return showWrongToken();
      // A 400 or 409 without a token error says nothing useful here.
      showError(
        result.error === "validation" || result.error === "conflict" ? "unexpected" : result.error,
      );
      if (result.error === "setup_closed") router.refresh();
    });
  }

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <CodeInput
        ref={codeRef}
        id={FIELD_ID}
        legend={t("token.legend")}
        hint={t("token.hint", { length: SETUP_TOKEN_LENGTH })}
        error={fieldError ? fieldErrorText("setupToken", fieldError) : undefined}
        invalid={rejected}
        value={code}
        onValueChange={(next) => {
          setCode(next);
          setFieldError(undefined);
          setRejected(false);
        }}
        {...SETUP_TOKEN_RULES}
        groupSize={4}
        defaultMasked
        toggleSubject={t("token.toggleSubject")}
      />
      <div className={styles.actions}>
        <Button variant="secondary" onClick={wizard.back}>
          {tCommon("back")}
        </Button>
        {/* Natively disabled until the token is complete: there is nothing the
            server could accept yet. `pending` keeps it focusable while sending. */}
        <Button
          type="submit"
          disabled={!complete}
          pending={isPending}
          aria-describedby={complete ? undefined : PROGRESS_ID}
        >
          {isPending ? t("token.verifying") : t("token.verify")}
        </Button>
        {complete ? null : (
          <p id={PROGRESS_ID} className={styles.note}>
            {t("token.progress", { length: SETUP_TOKEN_LENGTH, entered })}
          </p>
        )}
      </div>
    </form>
  );
}
