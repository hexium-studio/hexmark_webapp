import { totpStartHandler } from "../../../../../services/two-factor/endpoints";
import { setupActor } from "../../../_lib/setup-ticket";

// POST /api/setup/v1/two-factor/totp/start – see the contract in api/setup/v1/index.ts.
export const postSetupTotpStart = totpStartHandler(setupActor);
