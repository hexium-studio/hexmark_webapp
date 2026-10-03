import { registrationOptionsHandler } from "../../../../../../services/two-factor/endpoints";
import { setupActor } from "../../../../_lib/setup-ticket";

// POST /api/setup/v1/two-factor/webauthn/registration/options – see the contract in api/setup/v1/index.ts.
export const postSetupWebauthnOptions = registrationOptionsHandler(setupActor);
