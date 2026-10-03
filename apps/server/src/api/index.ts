import { Hono } from "hono";
import { instanceV1 } from "./instance/v1";
import { setupV1 } from "./setup/v1";

// All API modules, mounted at /api (src/index.ts). Each module version lives in
// api/<module>/<version>/ and is reachable at /api/<module>/<version>/<endpoint>.

export const api = new Hono();

api.route("/instance/v1", instanceV1);
api.route("/setup/v1", setupV1);
