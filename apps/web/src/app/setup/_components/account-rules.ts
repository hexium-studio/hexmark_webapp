import { ACCOUNT_LIMITS, usernameSchema } from "@hexmark/shared";
import type { AccountErrors, AccountFieldName } from "./account-form";

// The rules each account field shows as its checklist, and whether the
// current values meet them. Every rule is decided by the shared schema the
// server enforces (its error codes), never by a second copy of the rule:
// once all rules of a field are met, the server accepts that field too.

export type AccountRuleId =
  | "displayNameLength"
  | "usernameLength"
  | "usernameChars"
  | "emailValid"
  | "passwordLength"
  | "passwordMatch";

export interface AccountRule {
  id: AccountRuleId;
  // Placeholders of the rule's message "setup.account.rules.<id>".
  params?: Record<string, number>;
}

export const ACCOUNT_RULES: Record<AccountFieldName, readonly AccountRule[]> = {
  displayName: [{ id: "displayNameLength", params: { ...ACCOUNT_LIMITS.displayName } }],
  username: [
    { id: "usernameLength", params: { ...ACCOUNT_LIMITS.username } },
    { id: "usernameChars" },
  ],
  email: [{ id: "emailValid" }],
  password: [{ id: "passwordLength", params: { ...ACCOUNT_LIMITS.password } }],
  passwordConfirm: [{ id: "passwordMatch" }],
};

export type AccountRuleStates = Record<AccountRuleId, boolean>;

// `errors` is the check of the whole form (validateAccount). A field with a
// single rule meets it when the field has no error; the username has two
// rules, told apart by the codes its schema reports (all of them, not only
// the first one the form keeps).
export function accountRuleStates(
  values: Record<AccountFieldName, string>,
  errors: AccountErrors,
): AccountRuleStates {
  const parsed = usernameSchema.safeParse(values.username);
  const username = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message));
  return {
    displayNameLength: !errors.displayName,
    usernameLength: !username.has("too_short") && !username.has("too_long"),
    usernameChars: !username.has("invalid_format"),
    emailValid: !errors.email,
    passwordLength: !errors.password,
    passwordMatch: !errors.passwordConfirm,
  };
}
