import type { FieldError, FieldErrors } from "@hexmark/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Field problems as an agent reads them: the code and params the HTTP API
// sends, plus `rule`, one English sentence saying what the field must be
// ("title must not be empty"). The rule is derived from the code and the
// field's JSON Schema, the one tools/list announces, so it names the same
// type and format the agent was shown.

export interface JsonProperty {
  type?: string | string[];
  format?: string;
  minimum?: number;
  anyOf?: JsonProperty[];
}

export type FieldRuleError = FieldError & { rule: string };

// Free-text fields whose invalid_format is a character rule, not a format.
const CHARACTER_RULES: Record<string, string> = {
  title: "must not contain '/' or control characters such as line breaks and tabs",
  name: "must not contain '/' or control characters such as line breaks and tabs",
};

const FORMAT_NAMES: Record<string, string> = {
  uuid: "a UUID",
  "date-time": "an ISO 8601 date-time with time zone, e.g. 2026-10-01T00:00:00Z",
};

function variants(property: JsonProperty | undefined): JsonProperty[] {
  if (!property) return [];
  return property.anyOf ? property.anyOf.flatMap(variants) : [property];
}

function typeNameOf(property: JsonProperty): string {
  const format = property.format ? FORMAT_NAMES[property.format] : undefined;
  if (format) return format;
  switch (property.type) {
    case "string":
      return "a string";
    case "integer":
      return "a whole number";
    case "number":
      return "a number";
    case "boolean":
      return "true or false";
    case "null":
      return "null";
    default:
      return "a valid value";
  }
}

function typeName(property: JsonProperty | undefined): string {
  const names = [...new Set(variants(property).map(typeNameOf))];
  return names.length > 0 ? names.join(" or ") : "a valid value";
}

function isNumeric(property: JsonProperty | undefined): boolean {
  return variants(property).some((entry) => entry.type === "integer" || entry.type === "number");
}

function ruleText(field: string, error: FieldError, property: JsonProperty | undefined): string {
  const params = error.params ?? {};
  switch (error.code) {
    case "required":
      return "is required";
    case "empty":
      return "must not be empty";
    case "invalid_type":
      return `must be ${typeName(property)}`;
    case "too_long":
      if (params.maxBytes !== undefined) {
        return `must keep the note within ${params.maxBytes} bytes (UTF-8)`;
      }
      return isNumeric(property)
        ? `must be at most ${params.max}`
        : `must be at most ${params.max} characters`;
    case "invalid_format": {
      const named = variants(property).filter((entry) => entry.type !== "null");
      if (named.some((entry) => entry.format)) return `must be ${typeName(property)}`;
      return CHARACTER_RULES[field] ?? "does not have the required format";
    }
    case "invalid": {
      const minimum = variants(property).find((entry) => entry.minimum !== undefined)?.minimum;
      return minimum === undefined ? "is not valid" : `must be at least ${minimum}`;
    }
    default:
      return "is not valid";
  }
}

export function fieldRule(
  field: string,
  error: FieldError,
  property: JsonProperty | undefined,
): FieldRuleError {
  return { ...error, rule: `${field} ${ruleText(field, error, property)}` };
}

const MESSAGE =
  "The arguments break the rules of this tool; fields names each argument with its rule. " +
  "Fix them and call again.";

// The tool error for invalid arguments: { error: "invalid_input", message,
// fields: { <field>: { code, params?, rule } } }.
export function invalidInputResult(
  fields: FieldErrors,
  properties: Record<string, JsonProperty> = {},
): CallToolResult {
  const withRules: Record<string, FieldRuleError> = {};
  for (const [field, error] of Object.entries(fields)) {
    withRules[field] = fieldRule(field, error, properties[field]);
  }
  const body = { error: "invalid_input", message: MESSAGE, fields: withRules };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
