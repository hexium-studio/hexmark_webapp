import type { Context } from "hono";
import type { ActorRef } from "../../../services/two-factor/actor";
import { challengeActor } from "../../../services/two-factor/request-actor";

// Wizard steps 5 and 6 act with the setup enrolment ticket that
// create-first-admin returned (`Authorization: Challenge <token>`). It is
// valid for these endpoints only, for 15 minutes, until the system settings
// are saved.
export function setupActor(c: Context): ActorRef | Response {
  return challengeActor(c, "setup_enrolment");
}
