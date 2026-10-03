import { Hono } from "hono";
import { getInstanceLocale } from "./locale";

// Instance-wide information and settings, version 1. Mounted at
// /api/instance/v1 (src/api/index.ts).

export const instanceV1 = new Hono();

instanceV1.get("/locale", getInstanceLocale);
