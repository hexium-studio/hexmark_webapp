import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { SETUP_BODY_LIMIT_BYTES } from "../../../config/security";
import { createFirstAdminAccount } from "./create-first-admin";
import { getSetupStatus } from "./status";
import { verifySetupToken } from "./verify-token";

// First-run setup, version 1. Mounted at /api/setup/v1 (src/api/index.ts).

export const setupV1 = new Hono();

// The setup forms are tiny; refuse anything larger before parsing it.
setupV1.use(
  "*",
  bodyLimit({
    maxSize: SETUP_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

setupV1.get("/status", getSetupStatus);
setupV1.post("/verify-token", verifySetupToken);
setupV1.post("/create-first-admin", createFirstAdminAccount);
