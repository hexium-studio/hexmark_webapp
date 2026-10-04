// Conversions between JavaScript string indices (UTF-16 code units) and
// Unicode code points, the unit PostgreSQL counts characters in (substr,
// char_length). A character outside the Basic Multilingual Plane (most emoji)
// is two code units but one code point.

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

// Code point offsets of the given code unit offsets, in one pass over the
// text. An offset inside a surrogate pair counts as the pair's start.
export function toCodePointOffsets(text: string, offsets: readonly number[]): number[] {
  const order = offsets.map((offset, index) => ({ offset, index }));
  order.sort((a, b) => a.offset - b.offset);
  const result = new Array<number>(offsets.length);
  let unit = 0;
  let points = 0;
  for (const { offset, index } of order) {
    const target = Math.min(Math.max(offset, 0), text.length);
    while (unit < target) {
      const step =
        isHighSurrogate(text.charCodeAt(unit)) && isLowSurrogate(text.charCodeAt(unit + 1)) ? 2 : 1;
      if (unit + step > target) break;
      unit += step;
      points += 1;
    }
    result[index] = points;
  }
  return result;
}

// Code unit offsets of the given code point offsets (the inverse).
export function toCodeUnitOffsets(text: string, offsets: readonly number[]): number[] {
  const order = offsets.map((offset, index) => ({ offset, index }));
  order.sort((a, b) => a.offset - b.offset);
  const result = new Array<number>(offsets.length);
  let unit = 0;
  let points = 0;
  for (const { offset, index } of order) {
    while (points < offset && unit < text.length) {
      const pair =
        isHighSurrogate(text.charCodeAt(unit)) && isLowSurrogate(text.charCodeAt(unit + 1));
      unit += pair ? 2 : 1;
      points += 1;
    }
    result[index] = unit;
  }
  return result;
}

// The text between two code point offsets.
export function sliceCodePoints(text: string, start: number, end: number): string {
  const [from, to] = toCodeUnitOffsets(text, [start, end]);
  return text.slice(from, to);
}

export function countCodePoints(text: string): number {
  return toCodePointOffsets(text, [text.length])[0] ?? 0;
}
