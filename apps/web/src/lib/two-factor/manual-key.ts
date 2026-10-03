// The authenticator app's secret for typing it in by hand: base32 in groups
// of four, separated by spaces ("JBSW Y3DP EHPK 3PXP"). Apps ignore the
// spaces; the copy button copies the key without them.
export function groupManualKey(secret: string, size = 4): string[] {
  const compact = secret.replace(/\s+/g, "").toUpperCase();
  const groups: string[] = [];
  for (let start = 0; start < compact.length; start += size) {
    groups.push(compact.slice(start, start + size));
  }
  return groups;
}
