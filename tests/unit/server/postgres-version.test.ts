import { describe, expect, it } from "vitest";
import { requireSupportedVersion } from "../../../apps/server/src/db/migrate";
import { getDbStatus, setDbStatus } from "../../../apps/server/src/db/status";

// The start-up refusal of PostgreSQL older than 18 (uuidv7() for new ids),
// before any migration runs. The real check against PostgreSQL 17 and 18 is
// the version check of migration 0008 (integration tests).

function serverRunning(num: number, version: string) {
  return (async () => [{ num, version }]) as unknown as Parameters<
    typeof requireSupportedVersion
  >[0];
}

describe("requireSupportedVersion", () => {
  it("accepts PostgreSQL 18 and newer", async () => {
    setDbStatus({ reachable: true, migrated: false });
    await requireSupportedVersion(serverRunning(180_000, "18.0"));
    await requireSupportedVersion(serverRunning(190_002, "19.2"));
    expect(getDbStatus()).toEqual({ reachable: true, migrated: false });
  });

  it("refuses older servers with a clear message and status", async () => {
    await expect(requireSupportedVersion(serverRunning(170_011, "17.11"))).rejects.toThrow(
      "Hexmark needs PostgreSQL 18 or newer, this server runs 17.11. Upgrade PostgreSQL",
    );
    expect(getDbStatus()).toEqual({
      reachable: true,
      migrated: false,
      reason: "PostgreSQL 18 or newer required",
    });
    await expect(requireSupportedVersion(serverRunning(179_999, "18devel"))).rejects.toThrow();
  });
});
