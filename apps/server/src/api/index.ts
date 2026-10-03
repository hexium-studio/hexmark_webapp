import { Hono } from "hono";
import { accountV1 } from "./account/v1";
import { authV1 } from "./auth/v1";
import { instanceV1 } from "./instance/v1";
import { setupV1 } from "./setup/v1";

// All API modules, mounted at /api (src/index.ts). Each module version lives in
// api/<module>/<version>/ and is reachable at /api/<module>/<version>/<endpoint>.

export const api = new Hono();

api.route("/account/v1", accountV1);
api.route("/auth/v1", authV1);
api.route("/instance/v1", instanceV1);
api.route("/setup/v1", setupV1);
