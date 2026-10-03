import { useTranslations } from "next-intl";
import { type ToastAction, toast } from "@/components/toast/toast-store";
import type { Messages } from "@/lib/locales/registry";
import type { SetupErrorCode } from "./setup-result";
import type { WizardControls } from "./wizard-types";

// Setup errors that concern the form as a whole are shown as error toasts
// (UI-Richtlinien: field errors stay at the field). Their texts are the
// messages "setup.errors.<code>.title" and ".detail".

export type SetupToastCode = keyof Messages["setup"]["errors"];

// Errors that send the admin back to the connection check to fix the server.
export function needsConnectionCheck(code: SetupErrorCode): boolean {
  return (
    code === "setup_token_not_configured" ||
    code === "database_unavailable" ||
    code === "server_unreachable"
  );
}

// Returns a function that shows the error toast for a code. Errors the
// connection check explains get the action "Back to connection check";
// `action` replaces it.
export function useSetupErrorToast(wizard: WizardControls) {
  const t = useTranslations("setup");
  return (code: SetupToastCode, action?: ToastAction) => {
    const fallback =
      code !== "wrong_token" && needsConnectionCheck(code)
        ? { label: t("account.backToConnection"), onClick: () => wizard.goTo("connection") }
        : undefined;
    toast.error({
      title: t(`errors.${code}.title`),
      message: t(`errors.${code}.detail`),
      action: action ?? fallback,
    });
  };
}
