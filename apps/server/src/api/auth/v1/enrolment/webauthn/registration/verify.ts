import { registrationVerifyHandler } from "../../../../../../services/two-factor/endpoints";
import { enrolmentActor } from "../../../../_lib/enrolment-actor";

// POST /api/auth/v1/enrolment/webauthn/registration/verify – see the contract in api/auth/v1/index.ts.
export const postEnrolmentWebauthnVerify = registrationVerifyHandler(enrolmentActor);
