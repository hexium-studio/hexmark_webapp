import {
  changesQuerySchema,
  createNoteInputSchema,
  moveNoteInputSchema,
  noteViewQuerySchema,
  replaceSectionInputSchema,
  searchQueryParamsSchema,
  treeQuerySchema,
  updateNoteInputSchema,
} from "@hexmark/shared";
import type { Context } from "hono";
import { buildOpenApi, type RouteDoc } from "../../../lib/openapi";
import {
  both,
  FOLDER_IN_TRASH,
  IN_TRASH,
  noteWrite,
  TITLE_TAKEN,
  WRITE_RESULT,
  write,
} from "./openapi-common";
import { HIDDEN_ROUTES } from "./openapi-hidden";
import { LOCK_ROUTES } from "./openapi-locks";
import { FOLDER_ROUTES, TRASH_ROUTES } from "./openapi-trash";

// GET /api/notes/v1/openapi.json – the OpenAPI 3.1 document of this module,
// generated from the input schemas the endpoints validate with. Public: it
// describes the API, not any data. Answers in detail: index.ts.

const ROUTES: RouteDoc[] = [
  {
    method: "get",
    path: "/tree",
    summary: "Folders and note titles (no bodies)",
    security: both,
    query: treeQuerySchema,
    responses: { "200": "{ folder, folders, notes }", ...write, "409": FOLDER_IN_TRASH },
  },
  {
    method: "get",
    path: "/notes/{id}",
    summary: "A note: whole, outline or one section",
    security: both,
    query: noteViewQuerySchema,
    responses: {
      "200": "full: { note } | outline: { note, budget, sections } | section: { note, section }",
      ...write,
      "409": `ambiguous_section (section, candidates) | ${IN_TRASH}`,
    },
  },
  {
    method: "post",
    path: "/notes",
    summary: "Create a note",
    security: both,
    body: createNoteInputSchema,
    responses: {
      "201": WRITE_RESULT,
      ...write,
      "409": `${TITLE_TAKEN} | ${FOLDER_IN_TRASH}`,
    },
  },
  {
    method: "patch",
    path: "/notes/{id}",
    summary: "Change title and/or body",
    security: both,
    body: updateNoteInputSchema,
    responses: noteWrite,
  },
  {
    method: "put",
    path: "/notes/{id}/sections",
    summary: "Replace one section",
    security: both,
    body: replaceSectionInputSchema,
    responses: { ...noteWrite, "404": "not_found | section_not_found" },
  },
  {
    method: "post",
    path: "/notes/{id}/move",
    summary: "Move a note to another folder",
    security: both,
    body: moveNoteInputSchema,
    responses: { ...noteWrite, "409": `${noteWrite["409"]} | ${FOLDER_IN_TRASH}` },
  },
  {
    method: "get",
    path: "/notes/{id}/revisions",
    summary: "A note's revisions",
    security: both,
    responses: { "200": "{ noteId, path, revisions }", ...write },
  },
  {
    method: "get",
    path: "/notes/{id}/revisions/{version}",
    summary: "One revision (full snapshot)",
    security: both,
    responses: { "200": "{ revision: { noteId, version, ..., body, metadata } }", ...write },
  },
  {
    method: "get",
    path: "/search",
    summary: "Full-text search per section",
    security: both,
    query: searchQueryParamsSchema,
    responses: { "200": "{ hits }", ...write, "409": FOLDER_IN_TRASH },
  },
  {
    method: "get",
    path: "/changes",
    summary: "Notes changed since a time",
    security: both,
    query: changesQuerySchema,
    responses: { "200": "{ changes }", ...write },
  },
  ...FOLDER_ROUTES,
  ...TRASH_ROUTES,
  ...LOCK_ROUTES,
  ...HIDDEN_ROUTES,
];

let cached: unknown;

export function getOpenApi(c: Context): Response {
  cached ??= buildOpenApi(
    {
      title: "Hexmark notes API",
      version: "1",
      description:
        "Notes and folders of a Hexmark wiki. Errors are codes in `error`; " +
        "every write states the version it is based on (expectedVersion).",
      serverUrl: "/api/notes/v1",
    },
    ROUTES,
  );
  return c.json(cached as object, 200);
}
