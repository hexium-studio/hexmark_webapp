import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { PASSWORD } from "./auth-harness";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// Reads in the audit log: an agent's reads over the HTTP API are logged
// (source http, with what was read and the input), a person's reads never;
// a refused read is logged for both.

let world: NotesWorld;
let ada: Auth;
let agent: { auth: Auth; id: string; token: string };
let noteId: string;
let folderId: string;

const BODY = "read-marker-91ac intro\n\n# Part\npart-marker-4d0e\n";

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  agent = await apiToken(world, ada, { name: "reader", permissions: ["read", "search", "delete"] });
  folderId = await createFolder(world, ada, "Docs");
  noteId = await createNote(world, ada, { folderId, title: "Manual", body: BODY });
});

afterAll(async () => {
  const secrets = [PASSWORD, agent.token, "read-marker-91ac", "part-marker-4d0e"];
  expect(await expectNoSecrets(world.db, secrets)).toBeGreaterThan(10);
});

const get = (auth: Auth, path: string) => call(world.server, auth, "GET", `${notesApi}${path}`);

const READS: [string, string, Record<string, unknown>][] = [
  ["/tree?depth=2", "read.folder", { depth: 2, folderCount: 1, noteCount: 0 }],
  [`/tree?folder=${"FOLDER"}`, "read.folder", { noteCount: 1 }],
  [`/notes/${"NOTE"}`, "read.note", { version: 1, characters: Array.from(BODY).length }],
  [`/notes/${"NOTE"}?view=outline`, "read.outline", { sectionCount: 2 }],
  [`/notes/${"NOTE"}?view=section&section=Part&limit=5`, "read.section", { sectionPath: "Part" }],
  // The title is in every section of the note: two hits.
  ["/search?q=manual", "read.search", { query: "manual", hitCount: 2 }],
  ["/changes?since=2020-01-01T00:00:00Z", "read.changes", { changeCount: 1 }],
  [`/notes/${"NOTE"}/revisions`, "read.revisions", { revisionCount: 1 }],
  [`/notes/${"NOTE"}/revisions/1`, "read.revision", { version: 1 }],
  ["/trash", "read.trash", { entryCount: 0 }],
];

const path = (template: string) => template.replace("FOLDER", folderId).replace("NOTE", noteId);

describe("reads", () => {
  it("are logged for an agent, one event per read, with source http", async () => {
    for (const [template, action, details] of READS) {
      const { result, event } = await oneEvent(world.db, () => get(agent.auth, path(template)));
      expect((result as { status: number }).status, template).toBe(200);
      expect(event, template).toMatchObject({
        actor_kind: "agent",
        actor_token_id: agent.id,
        actor_name: "reader",
        source: "http",
        action,
        outcome: "success",
        details,
      });
    }
  });

  it("name the note or folder read", async () => {
    const note = await oneEvent(world.db, () => get(agent.auth, `/notes/${noteId}?view=outline`));
    expect(note.event).toMatchObject({
      target_kind: "note",
      target_id: noteId,
      target_label: "Docs/Manual",
    });
    const folder = await oneEvent(world.db, () => get(agent.auth, `/tree?folder=${folderId}`));
    expect(folder.event).toMatchObject({ target_kind: "folder", target_label: "Docs" });
  });

  it("are never logged for a person", async () => {
    for (const [template] of READS) {
      const { result, events } = await eventsOf(world.db, () => get(ada, path(template)));
      expect((result as { status: number }).status, template).toBe(200);
      expect(events, template).toEqual([]);
    }
  });

  it("are logged as failures when refused, for a person too", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const human = await oneEvent(world.db, () =>
      get(ada, `/notes/${missing}?view=section&section=x`),
    );
    expect(human.event).toMatchObject({
      actor_name: "ada",
      source: "web",
      action: "read.section",
      outcome: "failure",
      error_code: "not_found",
      details: { input: { note: missing, section: "x", includeSubsections: true } },
    });
    const bad = await oneEvent(world.db, () => get(agent.auth, "/notes/x/revisions/0"));
    expect(bad.event).toMatchObject({
      action: "read.revision",
      error_code: "not_found",
      details: { input: { note: "x", version: 0 } },
    });
    const query = await oneEvent(world.db, () => get(agent.auth, "/search?q="));
    expect(query.event).toMatchObject({
      action: "read.search",
      error_code: "validation",
      details: { refusal: { fields: [{ field: "q", error: "empty" }] } },
    });
  });

  it("keeps a long search query only shortened", async () => {
    const long = `${"wort ".repeat(90)}ende`;
    const { event } = await oneEvent(world.db, () =>
      get(agent.auth, `/search?q=${encodeURIComponent(long)}`),
    );
    const query = event.details.query as string;
    expect(Array.from(query)).toHaveLength(200);
    expect(query.endsWith("…")).toBe(true);
  });
});
