import { SETUP_TOKEN_FORMAT_HINT } from "@hexmark/shared";
import { isSetupOpen } from "./setup-state";
import { getSetupTokenState } from "./setup-token";

// Start-up log lines about SETUP_TOKEN. The server starts in every case; these
// messages tell the operator what to change. The token value is never logged.

// Runs before the database is known; only the format can be judged here.
export function reportSetupTokenFormat(): void {
  const { present, configured } = getSetupTokenState();
  if (present && !configured) {
    console.error(
      `Configuration error: SETUP_TOKEN is set but invalid (must be ${SETUP_TOKEN_FORMAT_HINT}).`,
    );
  }
}

// Runs once migrations are applied, when it is known whether setup is open.
export async function reportSetupTokenState(): Promise<void> {
  const { present, configured } = getSetupTokenState();
  let open: boolean;
  try {
    open = await isSetupOpen();
  } catch {
    console.error("Could not check whether setup is open; SETUP_TOKEN state not reported.");
    return;
  }
  if (open && !configured) {
    console.error(
      `Setup is open, but SETUP_TOKEN is ${present ? "invalid" : "not set"}. ` +
        `Set SETUP_TOKEN (${SETUP_TOKEN_FORMAT_HINT}) and restart the server to create the first admin.`,
    );
  } else if (!open && present) {
    console.warn(
      "Setup is complete, but SETUP_TOKEN is still set. Login is refused until " +
        "SETUP_TOKEN is removed from the environment and the server is restarted.",
    );
  }
}
