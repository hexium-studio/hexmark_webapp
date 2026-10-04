import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// /api/notes/v1: creating, reading (whole, outline, section), changing and
// replacing sections of notes, with versions, conflicts and revisions. Each
// test reads the rows the API wrote, not only its answers.

let world: NotesWorld;
let ada: Auth;
let adaId: string;

const BODY = "Intro text\n\n# Setup\nInstall it.\n\n## Docker\nRun compose.\n\n# Usage\nUse it.\n";

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

const get = (path: string) => call(world.server, ada, "GET", `${notesApi}${path}`);

describe("creating and reading", () => {
  it("creates version 1 with a revision by the username and its sections", async () => {
    const created = await call(world.server, ada, "POST", `${notesApi}/notes`, {
      title: "  Guide  ",
      body: BODY,
      reason: "first draft",
    });
    expect(created).toMatchObject({
      status: 201,
      body: { version: 1, changed: true, warnings: [] },
    });
    const id = created.body.id as string;
    expect(await revisionRows(world.db, id)).toEqual([
      {
        version: 1,
        change: "created",
        reason: "first draft",
        actor_name: "ada",
        actor_user_id: adaId,
        actor_token_id: null,
      },
    ]);
    const sections = await world.db.sql`
      select position, level, path, parent_position from note_sections
      where note_id = ${id} order by position`;
    expect(sections.map((row) => row.path)).toEqual([
      "(introduction)",
      "Setup",
      "Setup > Docker",
      "Usage",
    ]);
    const full = await get(`/notes/${id}`);
    expect(full.body.note).toMatchObject({ title: "Guide", body: BODY, version: 1, path: "Guide" });
  });

  it("reads the outline and single sections with and without subsections", async () => {
    const id = await createNote(world, ada, { title: "Outline", body: BODY });
    const outline = await get(`/notes/${id}?view=outline`);
    expect(outline.status).toBe(200);
    expect((outline.body.sections as { path: string }[]).map((s) => s.path)).toHaveLength(4);
    const withSubs = await get(`/notes/${id}?view=section&section=Setup`);
    expect(withSubs.body.section).toMatchObject({
      text: "# Setup\nInstall it.\n\n## Docker\nRun compose.\n\n",
      includesSubsections: true,
    });
    const alone = await get(`/notes/${id}?view=section&section=setup&subsections=false`);
    expect((alone.body.section as { text: string }).text).toBe("# Setup\nInstall it.\n\n");
    const byHeading = await get(`/notes/${id}?view=section&section=Docker`);
    expect((byHeading.body.section as { path: string }).path).toBe("Setup > Docker");
    const missing = await get(`/notes/${id}?view=section&section=Nope`);
    expect(missing).toMatchObject({ status: 404, body: { error: "section_not_found" } });
    expect(missing.body.paths).toContain("Setup > Docker");
  });

  it("refuses invalid titles, taken titles and unknown ids", async () => {
    for (const title of ["a/b", "   ", "line\nbreak", "x".repeat(201)]) {
      const response = await call(world.server, ada, "POST", `${notesApi}/notes`, {
        title,
        body: "",
      });
      expect(response.status, title).toBe(400);
      expect(response.body.error).toBe("validation");
    }
    await createNote(world, ada, { title: "Taken", body: "" });
    const taken = await call(world.server, ada, "POST", `${notesApi}/notes`, {
      title: "TAKEN",
      body: "",
    });
    expect(taken).toMatchObject({ status: 409, body: { error: "title_taken" } });
    expect((await get("/notes/not-a-uuid")).status).toBe(404);
    expect((await get("/notes/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const [row] = await world.db
      .sql`select count(*)::int as n from notes where lower(title) = 'taken'`;
    expect(row?.n).toBe(1);
  });
});

describe("changing", () => {
  it("raises the version per change and records the kind of change", async () => {
    const id = await createNote(world, ada, { title: "Changes", body: "one" });
    const patch = (body: Record<string, unknown>) =>
      call(world.server, ada, "PATCH", `${notesApi}/notes/${id}`, body);
    expect((await patch({ expectedVersion: 1, body: "two" })).body).toMatchObject({ version: 2 });
    expect((await patch({ expectedVersion: 2, title: "Renamed" })).body).toMatchObject({
      version: 3,
    });
    const same = await patch({ expectedVersion: 3, title: "Renamed", body: "two" });
    expect(same.body).toMatchObject({ version: 3, changed: false });
    const rows = await revisionRows(world.db, id);
    expect(rows.map((row) => [row.version, row.change])).toEqual([
      [1, "created"],
      [2, "edited"],
      [3, "renamed"],
    ]);
    const list = await get(`/notes/${id}/revisions`);
    expect((list.body.revisions as unknown[]).length).toBe(3);
    const old = await get(`/notes/${id}/revisions/1`);
    expect(old.body.revision).toMatchObject({ version: 1, body: "one", actorName: "ada" });
  });

  it("refuses a stale version with the current state and changes nothing", async () => {
    const id = await createNote(world, ada, { title: "Conflict", body: "base" });
    await call(world.server, ada, "PATCH", `${notesApi}/notes/${id}`, {
      expectedVersion: 1,
      body: "theirs",
    });
    const stale = await call(world.server, ada, "PATCH", `${notesApi}/notes/${id}`, {
      expectedVersion: 1,
      body: "mine",
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { error: "version_conflict", currentVersion: 2, updatedBy: "ada" },
    });
    const [row] = await world.db.sql`select body, version from notes where id = ${id}`;
    expect(row).toEqual({ body: "theirs", version: 2 });
  });

  it("replaces one section and reports a stale section write with its current text", async () => {
    const id = await createNote(world, ada, { title: "Sections", body: BODY });
    const put = (body: Record<string, unknown>) =>
      call(world.server, ada, "PUT", `${notesApi}/notes/${id}/sections`, body);
    const replaced = await put({
      expectedVersion: 1,
      heading: "Setup > Docker",
      body: "## Docker\nUse podman.",
    });
    expect(replaced.body).toMatchObject({ version: 2, changed: true });
    const [row] = await world.db.sql`select body from notes where id = ${id}`;
    // The blank line before the next heading is added.
    expect(row?.body).toBe(
      "Intro text\n\n# Setup\nInstall it.\n\n## Docker\nUse podman.\n\n# Usage\nUse it.\n",
    );
    const stale = await put({ expectedVersion: 1, heading: "Setup > Docker", body: "x" });
    expect(stale.status).toBe(409);
    expect(stale.body.currentSection).toEqual({
      path: "Setup > Docker",
      text: "## Docker\nUse podman.\n\n",
    });
    const missing = await put({ expectedVersion: 2, heading: "Nope", body: "x" });
    expect(missing).toMatchObject({ status: 404, body: { error: "section_not_found" } });
  });

  it("warns about sections over the reading budget", async () => {
    const long = `# Big\n${"word ".repeat(7000)}\n# Small\nok\n`;
    const created = await call(world.server, ada, "POST", `${notesApi}/notes`, {
      title: "Budget",
      body: long,
    });
    expect(created.body.warnings).toEqual([
      {
        code: "section_over_budget",
        path: "Big",
        approxTokens: 8752,
        budget: 8000,
        message:
          'Section "Big" exceeds the reading budget; split it with more headings or read it ' +
          "in chunks with offset/limit.",
      },
    ]);
    const outline = await get(`/notes/${created.body.id}?view=outline`);
    const flags = (outline.body.sections as { path: string; overBudget: boolean }[]).map((s) => [
      s.path,
      s.overBudget,
    ]);
    expect(flags).toEqual([
      ["Big", true],
      ["Small", false],
    ]);
  });
});
