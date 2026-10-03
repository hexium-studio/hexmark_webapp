"use client";

import type { FieldError } from "@hexmark/shared";
import { useLocale } from "next-intl";
import { useState } from "react";
import {
  ACCOUNT_FIELDS,
  type AccountErrors,
  type AccountFieldName,
  isAccountField,
  readAccountValues,
  validateAccount,
} from "./account-form";

// Live validation of the account step with the shared schema, on every change and
// without a server call. A field's message becomes visible only once the
// field was left (blur) or once its value had been valid: nobody is told
// "Use at least 12 characters" while typing the first one.

interface ValidationState {
  errors: AccountErrors;
  left: ReadonlySet<AccountFieldName>;
  validOnce: ReadonlySet<AccountFieldName>;
}

const EMPTY_VALUES: Record<AccountFieldName, string> = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  passwordConfirm: "",
};

function validate(
  values: Record<AccountFieldName, string>,
  setupToken: string,
  locale: string,
): AccountErrors {
  const result = validateAccount(values, setupToken, locale);
  return result.ok ? {} : result.errors;
}

export function useAccountValidation(setupToken: string) {
  const locale = useLocale();
  // The form starts empty, so the empty values give the first result.
  const [state, setState] = useState<ValidationState>(() => ({
    errors: validate(EMPTY_VALUES, setupToken, locale),
    left: new Set(),
    validOnce: new Set(),
  }));

  function revalidate(form: HTMLFormElement) {
    const errors = validate(readAccountValues(form), setupToken, locale);
    setState((current) => {
      const validOnce = new Set(current.validOnce);
      for (const { name } of ACCOUNT_FIELDS) if (!errors[name]) validOnce.add(name);
      return { ...current, errors, validOnce };
    });
  }

  function markLeft(name: string) {
    if (!isAccountField(name) || state.left.has(name)) return;
    setState((current) => ({ ...current, left: new Set(current.left).add(name) }));
  }

  function visibleError(name: AccountFieldName): FieldError | undefined {
    if (!state.left.has(name) && !state.validOnce.has(name)) return undefined;
    return state.errors[name];
  }

  // Fields that still keep the form from being sent.
  const incomplete = ACCOUNT_FIELDS.filter((field) => state.errors[field.name]).map(
    (field) => field.name,
  );

  return {
    revalidate,
    markLeft,
    visibleError,
    incomplete,
    // Only field problems block the button. A token problem cannot be fixed
    // here; submitting then shows the alert that leads back to step 2.
    blocked: incomplete.length > 0,
  };
}
