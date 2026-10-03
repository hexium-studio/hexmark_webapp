import type { TwoFactorOverview } from "@hexmark/shared";
import { challengeAuthorization } from "./challenge/challenge-store";
import { callServer } from "./server-api";
import { readTwoFactorOverview } from "./two-factor/overview";

// The setup enrolment ticket of the wizard's steps 5 and 6 (two-factor
// authentication, system settings), which create-first-admin returns once
// the admin exists. Setup is closed by then, so /setup shows these steps
// only while the browser holds a ticket (in the challenge cookie). Server
// code only.

export type SetupTicketState =
  // No ticket cookie: nothing to continue.
  | { kind: "none" }
  // A usable ticket and the admin's factors so far.
  | { kind: "active"; overview: TwoFactorOverview }
  // A cookie, but the ticket ran out (15 minutes) or was used up.
  | { kind: "expired" }
  // The server gave no usable answer.
  | { kind: "unavailable" };

export async function loadSetupTicket(): Promise<SetupTicketState> {
  const authorization = await challengeAuthorization();
  if (!authorization) return { kind: "none" };
  const response = await callServer("/api/setup/v1/two-factor/status", {
    headers: { authorization },
  });
  if (!response.reachable) return { kind: "unavailable" };
  if (response.status === 401) return { kind: "expired" };
  const overview = response.status === 200 ? readTwoFactorOverview(response.body) : undefined;
  return overview ? { kind: "active", overview } : { kind: "unavailable" };
}
