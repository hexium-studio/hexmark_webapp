import { registrationOptionsHandler } from "../../../../../services/two-factor/endpoints";
import { sessionActor } from "../../../../../services/two-factor/request-actor";

// POST /api/account/v1/webauthn/registration/options – see ../../index.ts.
export const postWebauthnRegistrationOptions = registrationOptionsHandler(sessionActor);
