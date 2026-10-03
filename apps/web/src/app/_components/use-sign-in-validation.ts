"use client";

import { useState } from "react";
import { EMPTY_SIGN_IN_VALUES, readSignInValues, validateSignIn } from "./sign-in-form";

// Live check of the sign-in form with the shared schema, on every change and
// without a server call. It only decides whether "Sign in" can be pressed:
// the form shows no field errors at all (UI guidelines: a simple form whose
// button waits for valid input needs none), and what the server refuses is
// a toast.
export function useSignInValidation() {
  const [blocked, setBlocked] = useState(() => !validateSignIn(EMPTY_SIGN_IN_VALUES).ok);

  function revalidate(form: HTMLFormElement) {
    setBlocked(!validateSignIn(readSignInValues(form)).ok);
  }

  return {
    revalidate,
    // "Sign in" stays disabled until the e-mail address is valid and a
    // password is entered.
    blocked,
  };
}
