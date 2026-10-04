import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// /api/notes/v1 with what the MCP tools got as well: blank versus missing
// fields, sections by the end of their path and in pieces, paths in write
// answers, title_taken naming the holder, lastChange with a conflict.

let world: NotesWorld;
let ada: Auth;

const send = (method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

describe("field codes", () => {
  it("tell a blank value (empty) from a missing one (required)", async () => {
    const [before] = await world.db.sql`select count(*)::int as n from notes`;
    const blank = await send("POST", "/notes", { title: "   ", body: "" });
    expect(blank).toEqual({
      status: 400,
      body: { error: "validation", fields: { title: { code: "empty" } } },
    });
    const missing = await send("POST", "/notes", { body: "" });
    expect(missing.body.fields).toEqual({ title: { code: "required" } });
    const move = await send("POST", "/notes/00000000-0000-4000-8000-000000000000/move", {
      expectedVersion: 1,
    });
    expect(move.body.fields).toEqual({ folderId: { code: "required" } });
    const [after] = await world.db.sql`select count(*)::int as n from notes`;
    expect(after?.n).toBe(before?.n);
  });
});

describe("sections", () => {
  it("reads by the end of a path, refuses a repeated heading, reads in pieces", async () => {
    const id = await createNote(world, ada, {
      title: "Sections",
      body: "# Top\n## Part\n### Leaf\nl1\nl2\nl3\n## Same\na\n## Same\nb\n",
    });
    const leaf = await send("GET", `/notes/${id}?view=section&section=part%20%3E%20leaf`);
    expect(leaf.body.section).toMatchObject({
      path: "Top > Part > Leaf",
      offset: 0,
      total: 18,
      returned: 18,
      hasMore: false,
      nextOffset: null,
    });
    const piece = await send("GET", `/notes/${id}?view=section&section=Leaf&offset=9&limit=5`);
    // Five characters from "l1\nl2\nl3\n" end inside "l2": cut after "l1\n".
    expect(piece.body.section).toMatchObject({
      text: "l1\n",
      offset: 9,
      returned: 3,
      hasMore: true,
      nextOffset: 12,
    });
    const twice = await send("GET", `/notes/${id}?view=section&section=same`);
    expect(twice).toMatchObject({
      status: 409,
      body: {
        error: "ambiguous_section",
        section: "same",
        candidates: ["Top > Same", "Top > Same (2)"],
      },
    });
    const missing = await send("GET", `/notes/${id}?view=section&section=Nope`);
    expect(missing).toMatchObject({ status: 404, body: { section: "Nope" } });
    // Past the end: offset is the end, requestedOffset the one asked for.
    const past = await send("GET", `/notes/${id}?view=section&section=Leaf&offset=40`);
    expect(past.body.section).toMatchObject({
      text: "",
      offset: 18,
      requestedOffset: 40,
      total: 18,
    });
    const atEnd = await send("GET", `/notes/${id}?view=section&section=Leaf&offset=18`);
    expect(atEnd.body.section).not.toHaveProperty("requestedOffset");
    const bad = await send("GET", `/notes/${id}?view=section&section=Leaf&limit=0`);
    expect(bad).toMatchObject({ status: 400, body: { fields: { limit: { code: "invalid" } } } });
  });
});

describe("write answers and refusals", () => {
  it("give the path, name the note holding a title, and what a newer version changed", async () => {
    const folder = await createFolder(world, ada, "Team");
    const created = await send("POST", "/notes", {
      folderId: folder,
      title: "Plan",
      body: "# A\n",
    });
    expect(created.body).toMatchObject({ folderPath: "Team", path: "Team/Plan", version: 1 });
    const taken = await send("POST", "/notes", { folderId: folder, title: "PLAN", body: "" });
    expect(taken).toEqual({
      status: 409,
      body: { error: "title_taken", existingNoteId: created.body.id, path: "Team/Plan" },
    });
    const section = await send("PUT", `/notes/${created.body.id}/sections`, {
      expectedVersion: 1,
      heading: "A",
      body: "# A\nnew\n",
      reason: "fill A",
    });
    expect(section.body).toMatchObject({ version: 2, path: "Team/Plan" });
    const stale = await send("PATCH", `/notes/${created.body.id}`, {
      expectedVersion: 1,
      title: "Late",
    });
    expect(stale.body).toMatchObject({
      error: "version_conflict",
      lastChange: { change: "edited", reason: "fill A", sectionPath: "A" },
    });
  });
});
