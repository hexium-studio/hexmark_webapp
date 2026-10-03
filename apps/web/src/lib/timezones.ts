import { canonicalTimezone } from "@hexmark/shared";

// The time zones a picker offers: every zone the runtime knows, plus "UTC",
// which Intl.supportedValuesOf("timeZone") leaves out (it lists canonical
// zones only). Grouped by region, the first part of the IANA name
// ("Europe/Berlin" -> "Europe"); "UTC" comes first in its own group. The
// server checks the choice again and stores Intl's spelling.

export const UTC_ZONE = "UTC";

export interface TimezoneOption {
  // IANA name, the value sent to the server.
  id: string;
  // The name without its region, underscores as spaces ("Argentina/Buenos Aires").
  label: string;
}

export interface TimezoneGroup {
  // "UTC" for the group of zones without a region.
  region: string;
  zones: TimezoneOption[];
}

function labelOf(id: string): string {
  const slash = id.indexOf("/");
  return (slash < 0 ? id : id.slice(slash + 1)).replaceAll("_", " ");
}

function regionOf(id: string): string {
  const slash = id.indexOf("/");
  return slash < 0 ? UTC_ZONE : id.slice(0, slash);
}

export function supportedTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

// `zones`: the runtime's list; `extra`: further zones to offer, e.g. the
// browser's own when the runtime lists it under another name.
export function timezoneGroups(
  zones: readonly string[],
  extra: readonly string[] = [],
): TimezoneGroup[] {
  const all = [...new Set([UTC_ZONE, ...zones, ...extra])];
  const groups = new Map<string, TimezoneOption[]>();
  for (const id of all) {
    const region = regionOf(id);
    const list = groups.get(region) ?? [];
    list.push({ id, label: labelOf(id) });
    groups.set(region, list);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === UTC_ZONE) return -1;
    if (b === UTC_ZONE) return 1;
    return a.localeCompare(b, "en");
  });
  return ordered.map(([region, list]) => ({
    region,
    zones: list.sort((a, b) => a.label.localeCompare(b.label, "en")),
  }));
}

// The zone the browser runs in, as a picker value: its own name if valid,
// else UTC. Browsers may report an alias ("Asia/Calcutta") that the runtime
// list does not contain; it is offered as it is (see `extra` above).
// `read` is the browser's answer, replaceable for tests.
export function browserTimezone(
  read: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  let zone: string | undefined;
  try {
    zone = read();
  } catch {
    zone = undefined;
  }
  // "Etc/UTC" and the like become "UTC", as the server would store them.
  return (zone && canonicalTimezone(zone)) || UTC_ZONE;
}
