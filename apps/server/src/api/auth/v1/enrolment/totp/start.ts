import { totpStartHandler } from "../../../../../services/two-factor/endpoints";
import { enrolmentActor } from "../../../_lib/enrolment-actor";

// POST /api/auth/v1/enrolment/totp/start – see the contract in api/auth/v1/index.ts.
export const postEnrolmentTotpStart = totpStartHandler(enrolmentActor);
