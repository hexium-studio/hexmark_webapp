import { totpConfirmHandler } from "../../../../services/two-factor/endpoints";
import { sessionActor } from "../../../../services/two-factor/request-actor";

// POST /api/account/v1/totp/confirm – see ../index.ts for the contract.
export const postTotpConfirm = totpConfirmHandler(sessionActor);
