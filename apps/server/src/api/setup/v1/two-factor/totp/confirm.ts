import { totpConfirmHandler } from "../../../../../services/two-factor/endpoints";
import { setupActor } from "../../../_lib/setup-ticket";

// POST /api/setup/v1/two-factor/totp/confirm – see the contract in api/setup/v1/index.ts.
export const postSetupTotpConfirm = totpConfirmHandler(setupActor);
