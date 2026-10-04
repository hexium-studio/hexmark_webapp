import { beforeAll, describe, expect, it } from "vitest";
import { eventsOf } from "./audit-log-harness";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// Requests with an API token that does not work (unknown, revoked) are
// logged as auth.token_rejected at most once per presented value in ten
// minutes per server, whichever way they come in (HTTP API, MCP); a working
// token is not affected. The count of the ones left out in the next event
// after the window is shown with a chosen clock in the unit tests
// (log-throttle.test.ts): this server's clock cannot be moved.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const tree = (bearer: string) =>
  fetch(`${world.server.url}${notesApi}/tree`, { headers: { authorization: `Bearer ${bearer}` } });

const rejected = (events: { action: string }[]) =>
  events.filter((event) => event.action === "auth.token_rejected");

describe("rejected tokens", () => {
  it("log an unknown value once, however often and by whichever way it is sent", async () => {
    const unknown = `hmk_${"B".repeat(43)}`;
    const { result, events } = await eventsOf(world.db, async () => {
      const statuses = [];
      for (let n = 0; n < 4; n++) statuses.push((await tree(unknown)).status);
      await connectMcp(world.server, unknown).catch(() => null);
      return statuses;
    });
    expect(result).toEqual([401, 401, 401, 401]);
    expect(events).toEqual([
      expect.objectContaining({
        action: "auth.token_rejected",
        actor_name: "invalid token",
        source: "http",
        error_code: "unauthenticated",
        details: {},
      }),
    ]);
    // Another value is its own case.
    const other = `hmk_${"C".repeat(43)}`;
    const second = await eventsOf(world.db, async () => {
      await tree(other);
      await tree(other);
    });
    expect(rejected(second.events)).toHaveLength(1);
  });

  it("log a revoked token once, by name, while a working token goes on as before", async () => {
    const doomed = await apiToken(world, ada, { name: "doomed", permissions: ["read"] });
    const working = await apiToken(world, ada, { name: "working", permissions: ["read"] });
    await call(world.server, ada, "DELETE", `/api/tokens/v1/tokens/${doomed.id}`);
    const { events } = await eventsOf(world.db, async () => {
      for (let n = 0; n < 3; n++) expect((await tree(doomed.token)).status).toBe(401);
    });
    expect(events).toEqual([
      expect.objectContaining({
        action: "auth.token_rejected",
        actor_name: "doomed",
        actor_token_id: doomed.id,
        error_code: "token_revoked",
      }),
    ]);
    const client = await connectMcp(world.server, working.token);
    const reads = await eventsOf(world.db, async () => {
      expect((await tree(working.token)).status).toBe(200);
      expect((await tool(client, "get_overview")).isError).toBe(false);
      expect((await tool(client, "get_overview")).isError).toBe(false);
    });
    expect(reads.events.map((event) => [event.action, event.actor_name, event.outcome])).toEqual([
      ["read.folder", "working", "success"],
      ["read.overview", "working", "success"],
      ["read.overview", "working", "success"],
    ]);
  });
});
