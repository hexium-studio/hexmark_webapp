import type { Context } from "hono";
import type { ActorRef } from "../../../services/two-factor/actor";
import { challengeActor } from "../../../services/two-factor/request-actor";

// Forced enrolment acts with the sign-in's enrolment challenge.
export function enrolmentActor(c: Context): ActorRef | Response {
  return challengeActor(c, "enrolment");
}
