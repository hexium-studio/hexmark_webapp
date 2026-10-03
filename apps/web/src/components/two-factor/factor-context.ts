// Where a second factor is being added, which decides the API endpoints and
// the credentials the actions use (actions.ts):
//   account   – the signed-in user's security page (session cookie);
//   enrolment – forced enrolment at sign-in (challenge cookie);
//   setup     – setup wizard step 5 (setup ticket in the challenge cookie).
export const FACTOR_CONTEXTS = ["account", "enrolment", "setup"] as const;

export type FactorContext = (typeof FACTOR_CONTEXTS)[number];
