import { z } from "zod";

// A small OpenAPI 3.1 document builder on top of Zod's own JSON Schema
// output (OpenAPI 3.1 uses JSON Schema 2020-12). Request bodies and query
// parameters come from the same schemas the endpoints validate with; answers
// are described in words and by status.

export interface RouteDoc {
  method: "get" | "post" | "put" | "patch" | "delete";
  // OpenAPI path template, e.g. "/notes/{id}".
  path: string;
  summary: string;
  security: ("session" | "bearer")[];
  query?: z.ZodType;
  body?: z.ZodType;
  // The body may be left out (all its fields are optional).
  bodyOptional?: boolean;
  // Status -> description.
  responses: Record<string, string>;
}

export interface ApiInfo {
  title: string;
  version: string;
  description: string;
  serverUrl: string;
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return rest;
}

function queryParameters(schema: z.ZodType) {
  const object = jsonSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(object.properties ?? {}).map(([name, property]) => ({
    name,
    in: "query",
    required: object.required?.includes(name) ?? false,
    schema: property,
  }));
}

function pathParameters(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
  additionalProperties: true,
};

export function buildOpenApi(info: ApiInfo, routes: readonly RouteDoc[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const parameters = [
      ...pathParameters(route.path),
      ...(route.query ? queryParameters(route.query) : []),
    ];
    const responses = Object.fromEntries(
      Object.entries(route.responses).map(([status, description]) => [
        status,
        {
          description,
          content: {
            "application/json": {
              schema: status.startsWith("2")
                ? { type: "object" }
                : { $ref: "#/components/schemas/Error" },
            },
          },
        },
      ]),
    );
    paths[route.path] ??= {};
    (paths[route.path] as Record<string, unknown>)[route.method] = {
      summary: route.summary,
      security: route.security.map((scheme) => ({ [scheme]: [] })),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(route.body
        ? {
            requestBody: {
              required: route.bodyOptional !== true,
              content: { "application/json": { schema: jsonSchema(route.body) } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: info.title, version: info.version, description: info.description },
    servers: [{ url: info.serverUrl }],
    paths,
    components: {
      schemas: { Error: ERROR_SCHEMA },
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "API token (hmk_...)" },
        session: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "`Session <token>`, sent by the web app's server",
        },
      },
    },
  };
}
