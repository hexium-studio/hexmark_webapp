"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import {
  ACCOUNT_FIELDS,
  type AccountErrors,
  type AccountFieldName,
  readAccountValues,
  validateAccount,
} from "./account-form";
import { type AccountRuleStates, accountRuleStates } from "./account-rules";

// Live check of the account step with the shared schema, on every change and
// without a server call. It drives the rule checklists under the fields and
// the submit button; it never shows an error at a field (those are for what
// the server rejects, see AccountStep).

interface ValidationState {
  errors: AccountErrors;
  rules: AccountRuleStates;
}

const EMPTY_VALUES: Record<AccountFieldName, string> = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  passwordConfirm: "",
};

function check(
  values: Record<AccountFieldName, string>,
  setupToken: string,
  locale: string,
): ValidationState {
  const result = validateAccount(values, setupToken, locale);
  const errors = result.ok ? {} : result.errors;
  return { errors, rules: accountRuleStates(values, errors) };
}

export function useAccountValidation(setupToken: string) {
  const locale = useLocale();
  // The form starts empty, so the empty values give the first result.
  const [state, setState] = useState(() => check(EMPTY_VALUES, setupToken, locale));

  function revalidate(form: HTMLFormElement) {
    setState(check(readAccountValues(form), setupToken, locale));
  }

  // Fields that still keep the form from being sent.
  const incomplete = ACCOUNT_FIELDS.filter((field) => state.errors[field.name]).map(
    (field) => field.name,
  );

  return {
    revalidate,
    rules: state.rules,
    incomplete,
    // Only field problems block the button. A token problem cannot be fixed
    // here; submitting then shows the toast that leads back to step 2.
    blocked: incomplete.length > 0,
  };
}
