import { describe, expect, it } from "vitest";
import { readFolderChoices } from "@/lib/api-tokens/folders";
import { deriveMcpUrl, serverPort } from "@/lib/api-tokens/mcp-url";
import { defaultPermissions, offeredPermissions } from "@/lib/api-tokens/offered-permissions";
import { readTokenFailure } from "@/lib/api-tokens/token-result";
import { resolveClientOrigin } from "@/lib/client-origin/resolve";
import { parseTrustConfig } from "@/lib/client-origin/trusted-proxies";

// The token page's pure parts: the MCP address built when the API server has
// no MCP_PUBLIC_URL (host of the request, SERVER_PORT, https only behind a
// trusted proxy that says so), the permissions offered per role, the folder
// list for the scope and how refusals are read.

describe("MCP address without MCP_PUBLIC_URL", () => {
  it("uses the request host and SERVER_PORT", () => {
    expect(deriveMcpUrl("wiki.example.com:3000", false, 3001)).toBe(
      "http://wiki.example.com:3001/mcp",
    );
    expect(deriveMcpUrl("wiki.example.com", false, 4001)).toBe("http://wiki.example.com:4001/mcp");
    expect(deriveMcpUrl("[::1]:3000", false, 3001)).toBe("http://[::1]:3001/mcp");
    expect(deriveMcpUrl("192.0.2.7:3000", false, 3001)).toBe("http://192.0.2.7:3001/mcp");
  });

  it("refuses hosts that are not plain host names", () => {
    for (const host of [
      null,
      undefined,
      "",
      " ",
      "a.example.com/path",
      "user@a.example.com",
      "a b",
    ]) {
      expect(deriveMcpUrl(host, false, 3001)).toBeUndefined();
    }
  });

  it("falls back to port 3001 for a missing or malformed SERVER_PORT", () => {
    expect(serverPort(undefined)).toBe(3001);
    expect(serverPort("")).toBe(3001);
    expect(serverPort("abc")).toBe(3001);
    expect(serverPort("0")).toBe(3001);
    expect(serverPort("70000")).toBe(3001);
    expect(serverPort(" 8443 ")).toBe(8443);
  });

  it("uses https only when a trusted proxy reports it", () => {
    const rules = parseTrustConfig("10.0.0.5", undefined);
    const headers = { forwardedFor: "198.51.100.4", forwardedProto: "https", clientHeader: null };
    const viaProxy = resolveClientOrigin({ ...headers, peer: "10.0.0.5" }, rules);
    const direct = resolveClientOrigin({ ...headers, peer: "198.51.100.9" }, rules);
    expect(deriveMcpUrl("wiki.example.com", viaProxy.secure, 3001)).toBe(
      "https://wiki.example.com:3001/mcp",
    );
    // A browser sending X-Forwarded-Proto itself is not believed.
    expect(deriveMcpUrl("wiki.example.com", direct.secure, 3001)).toBe(
      "http://wiki.example.com:3001/mcp",
    );
    const plain = resolveClientOrigin(
      { ...headers, forwardedProto: "http", peer: "10.0.0.5" },
      rules,
    );
    expect(deriveMcpUrl("wiki.example.com", plain.secure, 3001)).toBe(
      "http://wiki.example.com:3001/mcp",
    );
  });
});

describe("permissions offered for a new token", () => {
  it("offers what the role grants, with delete (trash tools) and without lock (no tool yet)", () => {
    const all = ["read", "search", "create", "edit", "move", "delete"];
    expect(offeredPermissions("admin")).toEqual(all);
    expect(offeredPermissions("user")).toEqual(all);
    expect(offeredPermissions("guest")).toEqual(["read", "search"]);
  });

  it("checks read and search by default", () => {
    expect(defaultPermissions("admin")).toEqual(["read", "search"]);
    expect(defaultPermissions("guest")).toEqual(["read", "search"]);
  });
});

describe("folders for the scope", () => {
  it("flattens the tree, ordered by path, with depths", () => {
    const body = {
      folder: null,
      notes: [],
      folders: [
        {
          id: "b",
          name: "Projects",
          path: "Projects",
          loaded: true,
          notes: [],
          folders: [{ id: "c", name: "Web", path: "Projects/Web", loaded: false, folderCount: 2 }],
        },
        { id: "a", name: "Archive", path: "Archive", loaded: true, folders: [], notes: [] },
      ],
    };
    expect(readFolderChoices(body)).toEqual([
      { id: "a", name: "Archive", path: "Archive", depth: 0 },
      { id: "b", name: "Projects", path: "Projects", depth: 0 },
      { id: "c", name: "Web", path: "Projects/Web", depth: 1 },
    ]);
    expect(readFolderChoices({ folders: [] })).toEqual([]);
    expect(readFolderChoices({ folders: [{ id: 1 }] })).toBeUndefined();
    expect(readFolderChoices({})).toBeUndefined();
    const broken = { folders: [{ id: "x", name: "X", path: "X", folders: null }] };
    expect(readFolderChoices(broken)).toBeUndefined();
    expect(readFolderChoices("nope")).toBeUndefined();
  });
});

describe("refusals of the token API", () => {
  it("puts a taken name at the name field", () => {
    const failure = readTokenFailure({
      reachable: true,
      status: 409,
      body: { error: "name_taken" },
    });
    expect(failure).toEqual({
      ok: false,
      error: "name_taken",
      fields: { name: { code: "taken" } },
    });
  });

  it("reads validation fields and maps unknown answers", () => {
    const validation = readTokenFailure({
      reachable: true,
      status: 400,
      body: { error: "validation", fields: { permissions: { code: "required" } } },
    });
    expect(validation.fields).toEqual({ permissions: { code: "required" } });
    expect(readTokenFailure({ reachable: true, status: 500, body: null }).error).toBe("unexpected");
    expect(readTokenFailure({ reachable: false }).error).toBe("server_unreachable");
  });
});
