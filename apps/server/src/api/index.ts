import { Hono } from "hono";
import { accountV1 } from "./account/v1";
import { auditV1 } from "./audit/v1";
import { authV1 } from "./auth/v1";
import { instanceV1 } from "./instance/v1";
import { notesV1 } from "./notes/v1";
import { setupV1 } from "./setup/v1";
import { tokensV1 } from "./tokens/v1";

// All API modules, mounted at /api (src/index.ts). Each module version lives in
// api/<module>/<version>/ and is reachable at /api/<module>/<version>/<endpoint>.

export const api = new Hono();

api.route("/account/v1", accountV1);
api.route("/audit/v1", auditV1);
api.route("/auth/v1", authV1);
api.route("/instance/v1", instanceV1);
api.route("/notes/v1", notesV1);
api.route("/setup/v1", setupV1);
api.route("/tokens/v1", tokensV1);
