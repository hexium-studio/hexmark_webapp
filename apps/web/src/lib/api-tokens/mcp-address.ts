import { headers } from "next/headers";
import { requestOrigin } from "@/lib/client-origin/request-origin";
import { deriveMcpUrl, serverPort } from "./mcp-url";

// The MCP address for the current request (server actions only): see
// mcp-url.ts. SERVER_PORT is passed to the web container by compose.
export async function currentMcpUrl(): Promise<string | undefined> {
  const list = await headers();
  const { secure } = requestOrigin(list);
  return deriveMcpUrl(list.get("host"), secure, serverPort(process.env.SERVER_PORT));
}
