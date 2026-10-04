import { type FieldErrors, fieldErrorsFromZod } from "@hexmark/shared";
import { type McpToolDefinition, mcpToolConfig } from "@hexmark/shared/mcp";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describeError } from "../lib/errors";
import { fail } from "../lib/outcome";
import type { AccessRef } from "../services/access/access";
import { recordAttemptFailure } from "../services/audit/access-events";
import { invalidInputResult, type JsonProperty } from "./input-rules";
import { errorResult } from "./results";
import { TOOL_ACTIONS } from "./tool-actions";

// The tools of one MCP server, checked here instead of in the SDK. tools/list
// announces each tool's input schema exactly as McpServer of the SDK would
// (draft-7 JSON Schema of the input side, tests/integration/mcp-tools-list),
// but tools/call checks the arguments itself: invalid arguments become the
// tool error invalid_input with a rule per field (input-rules.ts), in the same
// shape as every other Hexmark error, instead of the SDK's plain-text -32602.

type Shape = z.ZodRawShape;

export interface RegisteredTool {
  listed: Tool;
  // The checked arguments, or the field errors.
  parse(args: unknown): { ok: true; data: unknown } | { ok: false; fields: FieldErrors };
  // invalid_input for those field errors, with the rule per field.
  refuse(fields: FieldErrors): CallToolResult;
  run(data: unknown): Promise<CallToolResult>;
}

// The tool on its own, without the registry's logging: checked arguments,
// then the tool, or invalid_input.
export function callTool(tool: RegisteredTool, args: unknown): Promise<CallToolResult> {
  const parsed = tool.parse(args);
  return parsed.ok ? tool.run(parsed.data) : Promise.resolve(tool.refuse(parsed.fields));
}

export function defineTool<S extends Shape>(
  definition: McpToolDefinition<S>,
  run: (args: z.output<z.ZodObject<S>>) => Promise<CallToolResult>,
): RegisteredTool {
  const schema = z.object(definition.input);
  const inputSchema = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
  }) as Tool["inputSchema"];
  const properties = (inputSchema.properties ?? {}) as Record<string, JsonProperty>;
  const config = mcpToolConfig(definition);
  return {
    listed: {
      name: definition.name,
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: config.annotations,
      // What McpServer announces for a tool without task support.
      execution: { taskSupport: "forbidden" },
    },
    refuse: (fields) => invalidInputResult(fields, properties),
    parse(args) {
      const parsed = schema.safeParse(args ?? {});
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, fields: fieldErrorsFromZod(parsed.error) };
    },
    run: (data) => run(data as z.output<z.ZodObject<S>>),
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  // The token every call acts for: refused arguments are logged for it.
  constructor(private readonly ref: AccessRef) {}

  add(...tools: RegisteredTool[]): void {
    for (const tool of tools) this.tools.set(tool.listed.name, tool);
  }

  list(): Tool[] {
    return [...this.tools.values()].map((tool) => tool.listed);
  }

  // An unknown tool is a protocol error (-32602), as in the SDK. Invalid
  // arguments are logged as a failure of the tool's action (the services log
  // everything after that). A tool that throws is logged and answered with
  // the tool error "internal".
  async call(name: string, args: unknown): Promise<CallToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`);
    const parsed = tool.parse(args);
    if (!parsed.ok) {
      const action = TOOL_ACTIONS[name as keyof typeof TOOL_ACTIONS];
      const failure = fail(400, "invalid_input", { fields: parsed.fields });
      if (action) await recordAttemptFailure({ ref: this.ref, action, input: args }, failure);
      return tool.refuse(parsed.fields);
    }
    try {
      return await tool.run(parsed.data);
    } catch (error) {
      console.error(`MCP tool ${name} failed: ${describeError(error)}`);
      return errorResult("internal");
    }
  }
}
