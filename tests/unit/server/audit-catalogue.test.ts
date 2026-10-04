import {
  AUDIT_ACTION_CODES,
  AUDIT_ACTIONS,
  AUDIT_RETENTION_DAYS,
  auditEventsQuerySchema,
  isAuditAction,
} from "@hexmark/shared";
import { MCP_TOOLS } from "@hexmark/shared/mcp";
import { describe, expect, it } from "vitest";
import { readAuditRetention } from "../../../apps/server/src/config/audit";
import { TOOL_ACTIONS } from "../../../apps/server/src/mcp/tool-actions";
import { decodeCursor, encodeCursor } from "../../../apps/server/src/services/audit/query-cursor";
import { auditPurgeCutoff } from "../../../apps/server/src/services/audit/retention";

// The action catalogue (@hexmark/shared), the actions of the MCP tools, the
// query string of GET /api/audit/v1/events, the cursor, and the retention
// (AUDIT_RETENTION_DAYS) with its cutoff.

describe("the catalogue", () => {
  it("has only codes the table accepts", () => {
    expect(AUDIT_ACTION_CODES.length).toBeGreaterThan(40);
    for (const code of AUDIT_ACTION_CODES) {
      expect(code, code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(code.length, code).toBeLessThanOrEqual(64);
      const { target, description, outcomes } = AUDIT_ACTIONS[code];
      if (target !== null) expect(target).toMatch(/^[a-z][a-z_]{0,31}$/);
      expect(description.endsWith("."), code).toBe(true);
      expect(["success", "failure", "both"]).toContain(outcomes);
    }
    expect(isAuditAction("note.created")).toBe(true);
    expect(isAuditAction("note.toString")).toBe(false);
  });

  it("gives every MCP tool an action of the catalogue, reads under read.*", () => {
    expect(Object.keys(TOOL_ACTIONS).sort()).toEqual(Object.keys(MCP_TOOLS).sort());
    for (const [name, action] of Object.entries(TOOL_ACTIONS)) {
      expect(isAuditAction(action), name).toBe(true);
      const readOnly = MCP_TOOLS[name as keyof typeof MCP_TOOLS].readOnly;
      expect(action.startsWith("read."), name).toBe(readOnly);
    }
  });
});

describe("the query string", () => {
  const parse = (query: Record<string, string>) => auditEventsQuerySchema.safeParse(query);

  it("takes an exact action or a prefix ending in a dot", () => {
    expect(parse({ action: "note.updated" }).success).toBe(true);
    expect(parse({ action: "note." }).success).toBe(true);
    expect(parse({ action: "Note" }).success).toBe(false);
    expect(parse({ action: "note.." }).success).toBe(false);
  });

  it("limits pages to 200 (default 50) and reads times with a zone", () => {
    expect(parse({}).data).toMatchObject({ limit: 50, actorMatch: "exact" });
    expect(parse({ limit: "200" }).success).toBe(true);
    expect(parse({ limit: "201" }).success).toBe(false);
    expect(parse({ from: "2026-10-04T10:00:00+02:00" }).data?.from?.toISOString()).toBe(
      "2026-10-04T08:00:00.000Z",
    );
    expect(parse({ to: "2026-10-04" }).success).toBe(false);
    expect(parse({ targetId: "nope" }).success).toBe(false);
  });
});

describe("the cursor", () => {
  it("round-trips the time in microseconds and the id, and refuses anything else", () => {
    const id = "01a105c3-e280-7bb1-8000-000000000001";
    const cursor = encodeCursor("2026-10-04T08:00:00.123456Z", id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ at: "2026-10-04T08:00:00.123456Z", id });
    expect(decodeCursor("bm90LWEtY3Vyc29y")).toBeNull();
    expect(decodeCursor(encodeCursor("2026-10-04T08:00:00Z", id))).toBeNull();
  });
});

describe("retention", () => {
  it("defaults to 365 days, takes 1 to 3650 and refuses anything else with a reason", () => {
    expect(readAuditRetention({})).toEqual({ days: 365, problem: null });
    expect(readAuditRetention({ AUDIT_RETENTION_DAYS: " 30 " })).toEqual({
      days: 30,
      problem: null,
    });
    expect(readAuditRetention({ AUDIT_RETENTION_DAYS: "1" }).days).toBe(1);
    expect(readAuditRetention({ AUDIT_RETENTION_DAYS: "3650" }).days).toBe(3650);
    for (const value of ["0", "3651", "-5", "1.5", "a year", "1e3"]) {
      const config = readAuditRetention({ AUDIT_RETENTION_DAYS: value });
      expect(config.days, value).toBe(AUDIT_RETENTION_DAYS.default);
      expect(config.problem, value).toContain("AUDIT_RETENTION_DAYS must be a whole number");
    }
  });

  it("deletes what is at least the retention old: the cutoff", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(auditPurgeCutoff(now, 365).toISOString()).toBe("2025-10-04T12:00:00.000Z");
    expect(auditPurgeCutoff(now, 1).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });
});
