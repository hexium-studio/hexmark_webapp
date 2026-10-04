import { createHash } from "node:crypto";
import { API_TOKEN_PATTERN } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { readMcpPublicUrl } from "../../../apps/server/src/config/mcp";
import {
  DEFAULT_SECTION_TOKEN_BUDGET,
  readSectionBudget,
} from "../../../apps/server/src/config/notes";
import {
  newApiToken,
  readApiToken,
} from "../../../apps/server/src/services/api-tokens/token-format";

// API token format and the notes and MCP settings from the environment.

describe("API tokens", () => {
  it("are hmk_ + 43 base64url characters, stored as SHA-256 hex with an 8-character prefix", () => {
    const { token, hash, prefix } = newApiToken();
    expect(token).toMatch(API_TOKEN_PATTERN);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(token.slice(0, 8));
    expect(prefix).toMatch(/^hmk_[A-Za-z0-9_-]{4}$/);
    expect(newApiToken().token).not.toBe(token);
  });

  it("are read from a Bearer header only", () => {
    const { token } = newApiToken();
    expect(readApiToken(`Bearer ${token}`)).toBe(token);
    expect(readApiToken(`bearer   ${token}`)).toBe(token);
    expect(readApiToken(`Session ${token}`)).toBeNull();
    expect(readApiToken(`Bearer ${token.slice(4)}`)).toBeNull();
    expect(readApiToken(`Bearer ${token}x`)).toBeNull();
    expect(readApiToken(undefined)).toBeNull();
  });
});

describe("SECTION_TOKEN_BUDGET", () => {
  it("defaults to 8000 and accepts whole numbers in range", () => {
    expect(readSectionBudget({})).toEqual({ budget: DEFAULT_SECTION_TOKEN_BUDGET, problem: null });
    expect(readSectionBudget({ SECTION_TOKEN_BUDGET: " 4000 " })).toEqual({
      budget: 4000,
      problem: null,
    });
  });

  it("falls back to the default with a problem for anything else", () => {
    for (const value of ["abc", "-5", "1.5", "50", "2000000"]) {
      const result = readSectionBudget({ SECTION_TOKEN_BUDGET: value });
      expect(result.budget, value).toBe(DEFAULT_SECTION_TOKEN_BUDGET);
      expect(result.problem, value).toContain("SECTION_TOKEN_BUDGET");
    }
  });
});

describe("MCP_PUBLIC_URL", () => {
  it("is optional and normalised", () => {
    expect(readMcpPublicUrl({})).toEqual({ url: null, problem: null });
    expect(readMcpPublicUrl({ MCP_PUBLIC_URL: "https://wiki.example.com/mcp/" })).toEqual({
      url: "https://wiki.example.com/mcp",
      problem: null,
    });
    expect(readMcpPublicUrl({ MCP_PUBLIC_URL: "http://10.0.0.5:3001/hexmark/mcp" }).url).toBe(
      "http://10.0.0.5:3001/hexmark/mcp",
    );
  });

  it("is ignored with a problem unless it is an http(s) URL ending in /mcp", () => {
    for (const value of [
      "wiki.example.com/mcp",
      "ftp://example.com/mcp",
      "https://example.com/api",
      "https://example.com/mcp?x=1",
      "https://user:secret@example.com/mcp",
    ]) {
      const result = readMcpPublicUrl({ MCP_PUBLIC_URL: value });
      expect(result.url, value).toBeNull();
      expect(result.problem, value).toContain("MCP_PUBLIC_URL");
    }
  });
});
