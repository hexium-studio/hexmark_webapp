import { registrationVerifyHandler } from "../../../../../services/two-factor/endpoints";
import { sessionActor } from "../../../../../services/two-factor/request-actor";

// POST /api/account/v1/webauthn/registration/verify – see ../../index.ts.
export const postWebauthnRegistrationVerify = registrationVerifyHandler(sessionActor);
