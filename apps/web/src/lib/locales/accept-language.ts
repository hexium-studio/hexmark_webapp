// Picks the best available locale from an Accept-Language header
// (RFC 9110, section 12.5.4). Ranges are tried by descending q value, equal
// values in header order; "de-AT" falls back to "de". "*" and q=0 ("not
// acceptable") are ignored, as are malformed q values.

interface LanguageRange {
  tag: string;
  q: number;
  order: number;
}

function parseRange(part: string, order: number): LanguageRange {
  const [tag = "", ...params] = part.split(";");
  let q = 1;
  for (const param of params) {
    const [name = "", value = ""] = param.split("=");
    if (name.trim().toLowerCase() !== "q") continue;
    const parsed = Number(value.trim());
    q = value.trim() !== "" && parsed >= 0 && parsed <= 1 ? parsed : 0;
  }
  return { tag: tag.trim().toLowerCase(), q, order };
}

export function matchAcceptLanguage(
  header: string | null | undefined,
  available: readonly string[],
): string | undefined {
  if (!header) return undefined;
  const byLowerCase = new Map(available.map((code) => [code.toLowerCase(), code]));
  const ranges = header
    .split(",")
    .map(parseRange)
    .filter((range) => range.tag !== "" && range.tag !== "*" && range.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  for (const { tag } of ranges) {
    const match = byLowerCase.get(tag) ?? byLowerCase.get(tag.split("-")[0] ?? "");
    if (match) return match;
  }
  return undefined;
}
