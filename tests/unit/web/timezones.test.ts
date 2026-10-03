import { describe, expect, it } from "vitest";
import { browserTimezone, supportedTimezones, timezoneGroups, UTC_ZONE } from "@/lib/timezones";

// The time zone picker of setup step 6: every zone of the runtime plus UTC
// (which Intl.supportedValuesOf leaves out), grouped by region.

describe("timezoneGroups", () => {
  const groups = timezoneGroups(supportedTimezones());
  const ids = groups.flatMap((group) => group.zones.map((zone) => zone.id));

  it("offers UTC first, in its own group", () => {
    expect(supportedTimezones()).not.toContain(UTC_ZONE);
    expect(groups[0]).toEqual({ region: "UTC", zones: [{ id: "UTC", label: "UTC" }] });
  });

  it("offers every zone of the runtime once", () => {
    expect(ids).toHaveLength(supportedTimezones().length + 1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups by region in alphabetical order, labels without the region", () => {
    const regions = groups.slice(1).map((group) => group.region);
    expect(regions).toEqual([...regions].sort());
    expect(regions).toContain("Europe");
    const europe = groups.find((group) => group.region === "Europe");
    expect(europe?.zones).toContainEqual({ id: "Europe/Berlin", label: "Berlin" });
    const america = groups.find((group) => group.region === "America");
    expect(america?.zones).toContainEqual({
      id: "America/Argentina/Rio_Gallegos",
      label: "Argentina/Rio Gallegos",
    });
    const labels = europe?.zones.map((zone) => zone.label) ?? [];
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("adds a zone the runtime lists under another name", () => {
    const withAlias = timezoneGroups(["Asia/Kolkata"], ["Asia/Calcutta"]);
    expect(withAlias.find((group) => group.region === "Asia")?.zones.map((z) => z.id)).toEqual([
      "Asia/Calcutta",
      "Asia/Kolkata",
    ]);
  });
});

describe("browserTimezone", () => {
  it("preselects the browser's zone in Intl's spelling", () => {
    expect(browserTimezone(() => "Europe/Berlin")).toBe("Europe/Berlin");
    expect(browserTimezone(() => "Etc/UTC")).toBe("UTC");
    expect(browserTimezone(() => "europe/berlin")).toBe("Europe/Berlin");
  });

  it("falls back to UTC for nothing usable", () => {
    expect(browserTimezone(() => "")).toBe("UTC");
    expect(browserTimezone(() => undefined)).toBe("UTC");
    expect(browserTimezone(() => "Mars/Olympus")).toBe("UTC");
    expect(
      browserTimezone(() => {
        throw new Error("no Intl");
      }),
    ).toBe("UTC");
  });
});
