import { totpConfirmHandler } from "../../../../../services/two-factor/endpoints";
import { enrolmentActor } from "../../../_lib/enrolment-actor";

// POST /api/auth/v1/enrolment/totp/confirm – see the contract in api/auth/v1/index.ts.
export const postEnrolmentTotpConfirm = totpConfirmHandler(enrolmentActor);
