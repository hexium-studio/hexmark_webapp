import { totpStartHandler } from "../../../../services/two-factor/endpoints";
import { sessionActor } from "../../../../services/two-factor/request-actor";

// POST /api/account/v1/totp/start – see ../index.ts for the contract.
export const postTotpStart = totpStartHandler(sessionActor);
