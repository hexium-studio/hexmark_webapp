import { registrationOptionsHandler } from "../../../../../../services/two-factor/endpoints";
import { enrolmentActor } from "../../../../_lib/enrolment-actor";

// POST /api/auth/v1/enrolment/webauthn/registration/options – see the contract in api/auth/v1/index.ts.
export const postEnrolmentWebauthnOptions = registrationOptionsHandler(enrolmentActor);
