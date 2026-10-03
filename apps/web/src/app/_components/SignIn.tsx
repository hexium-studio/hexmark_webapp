import { SignInFlow } from "./SignInFlow";

export interface SignInProps {
  // The API server gave no usable answer while loading the page.
  serverDown: boolean;
}

// The sign-in page: brand, heading and the steps of signing in in the narrow
// card (SignInFlow). No language picker: the page follows the language of
// the last account signed in on this device, else the browser
// (lib/locales/locale-order.ts). A hint for lost access is left out on
// purpose: without a password reset there is nothing to point to yet.
export function SignIn({ serverDown }: SignInProps) {
  return <SignInFlow serverDown={serverDown} />;
}
