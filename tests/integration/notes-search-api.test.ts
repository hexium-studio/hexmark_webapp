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

// /api/notes/v1 search (per section, with snippets) and changes since a time.

let world: NotesWorld;
let ada: Auth;
let docs: string;
let alphaId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  docs = await createFolder(world, ada, "Docs");
  const deep = await createFolder(world, ada, "Deep", docs);
  alphaId = await createNote(world, ada, {
    folderId: docs,
    title: "Alpha",
    body: "# Install\nUse the zebracorn installer.\n\n# Usage\nNothing special here.\n",
  });
  await createNote(world, ada, {
    folderId: deep,
    title: "Beta",
    body: "Intro about zebracorn grooming.\n\n# Code\n```\nzebracorn in code\n```\n",
  });
  await createNote(world, ada, { title: "Gamma", body: "# Other\nNo match.\n" });
});

const search = (query: string) => call(world.server, ada, "GET", `${notesApi}/search?${query}`);

interface Hit {
  noteId: string;
  title: string;
  folderPath: string;
  sectionPath: string;
  snippet: string;
  version: number;
}

describe("search", () => {
  it("finds sections with snippets, note title, folder path and version", async () => {
    const response = await search("q=zebracorn");
    expect(response.status).toBe(200);
    const hits = response.body.hits as Hit[];
    expect(hits.map((hit) => `${hit.title}: ${hit.sectionPath}`).sort()).toEqual([
      "Alpha: Install",
      "Beta: (introduction)",
      "Beta: Code",
    ]);
    const alpha = hits.find((hit) => hit.title === "Alpha");
    expect(alpha).toMatchObject({ noteId: alphaId, folderPath: "Docs", version: 1 });
    expect(alpha?.snippet).toContain("«zebracorn»");
  });

  it("matches the note title in every section and supports web search syntax", async () => {
    const titled = (await search("q=gamma")).body.hits as Hit[];
    expect(titled.map((hit) => hit.sectionPath)).toEqual(["Other"]);
    const phrase = (await search(`q=${encodeURIComponent('"zebracorn installer"')}`)).body
      .hits as Hit[];
    expect(phrase.map((hit) => hit.title)).toEqual(["Alpha"]);
    const excluded = (await search(`q=${encodeURIComponent("zebracorn -grooming -code")}`)).body
      .hits as Hit[];
    expect(excluded.map((hit) => hit.title)).toEqual(["Alpha"]);
  });

  it("limits to a folder with its subfolders and to the limit", async () => {
    const hits = (await search(`q=zebracorn&folder=${docs}&limit=50`)).body.hits as Hit[];
    expect(hits).toHaveLength(3);
    expect(((await search("q=zebracorn&limit=1")).body.hits as Hit[]).length).toBe(1);
    expect((await search("q=")).status).toBe(400);
    expect((await search("q=zebracorn&limit=51")).status).toBe(400);
  });

  it("does not find notes in the trash", async () => {
    const id = await createNote(world, ada, { title: "Ephemeral", body: "quokkaword" });
    expect(((await search("q=quokkaword")).body.hits as Hit[]).length).toBe(1);
    await call(world.server, ada, "DELETE", `${notesApi}/notes/${id}`, { expectedVersion: 1 });
    expect(((await search("q=quokkaword")).body.hits as Hit[]).length).toBe(0);
  });
});

describe("changes", () => {
  it("lists notes changed since a time with the latest change and actor", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const id = await createNote(world, ada, { title: "Fresh", body: "a" });
    await call(world.server, ada, "PATCH", `${notesApi}/notes/${id}`, {
      expectedVersion: 1,
      title: "Fresher",
      reason: "better name",
    });
    const response = await call(
      world.server,
      ada,
      "GET",
      `${notesApi}/changes?since=${encodeURIComponent(before)}`,
    );
    const entry = (response.body.changes as Record<string, unknown>[]).find(
      (change) => change.noteId === id,
    );
    expect(entry).toMatchObject({
      title: "Fresher",
      version: 2,
      change: "renamed",
      changes: 2,
      actorName: "ada",
      reason: "better name",
      deleted: false,
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await call(
      world.server,
      ada,
      "GET",
      `${notesApi}/changes?since=${encodeURIComponent(future)}`,
    );
    expect(none.body.changes).toEqual([]);
    const bad = await call(world.server, ada, "GET", `${notesApi}/changes?since=yesterday`);
    expect(bad).toMatchObject({
      status: 400,
      body: { fields: { since: { code: "invalid_format" } } },
    });
  });
});

describe("OpenAPI document", () => {
  it("is public and generated from the input schemas", async () => {
    const response = await call(world.server, null, "GET", `${notesApi}/openapi.json`);
    expect(response.status).toBe(200);
    const paths = response.body.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(paths)).toContain("/notes/{id}/sections");
    const body = paths["/notes"]?.post?.requestBody as {
      content: { "application/json": { schema: { required: string[] } } };
    };
    expect(body.content["application/json"].schema.required).toEqual(["title", "body"]);
    const search = paths["/search"]?.get?.parameters as { name: string }[];
    expect(search.map((parameter) => parameter.name)).toEqual(["q", "folder", "limit"]);
    // The trash: every route, an optional body where all fields are optional.
    expect(Object.keys(paths["/trash"] ?? {}).sort()).toEqual(["delete", "get"]);
    expect(Object.keys(paths["/trash/notes/{id}"] ?? {})).toEqual(["delete"]);
    expect(Object.keys(paths["/trash/folders/{id}"] ?? {})).toEqual(["delete"]);
    expect(Object.keys(paths["/folders/{id}"] ?? {}).sort()).toEqual(["delete", "patch"]);
    const restore = paths["/notes/{id}/restore"]?.post?.requestBody as { required: boolean };
    expect(restore.required).toBe(false);
    const trashNote = paths["/notes/{id}"]?.delete?.requestBody as { required: boolean };
    expect(trashNote.required).toBe(true);
  });
});
