import { CLIENT_IP_HEADER, INTERNAL_KEY_HEADER } from "@hexmark/shared/internal-calls";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { internalApiKey } from "../internal-key";
import { requestOrigin } from "./request-origin";

// Headers that tell the API server which browser a call is made for
// (apps/server/src/services/client-address.ts). Added by callServer() to
// every call, so no call site can forget them.

// The address of the request being handled, if there is one. Outside a
// request (start-up, tests) there is none. Next.js signals some rendering
// states by throwing from headers(); those must pass through.
async function currentRequestIp(): Promise<string | undefined> {
  try {
    return requestOrigin(await headers()).ip;
  } catch (error) {
    unstable_rethrow(error);
    return undefined;
  }
}

// `clientIp`: undefined takes the current request's address (server
// components, server actions); the request proxy passes its own, as
// next/headers is not available there; null sends none.
export async function forwardingHeaders(
  clientIp: string | null | undefined,
): Promise<Record<string, string>> {
  const key = internalApiKey();
  if (!key) return {};
  const ip = clientIp === undefined ? await currentRequestIp() : clientIp;
  return ip ? { [CLIENT_IP_HEADER]: ip, [INTERNAL_KEY_HEADER]: key } : {};
}
