import { countCodePoints, toCodeUnitOffsets } from "../../lib/code-points";

// Reading a long section in pieces. Offsets and lengths are characters
// (Unicode code points), the unit of the stored section offsets. Pure.

export interface TextChunk {
  text: string;
  // Where `text` starts in the whole text, and its length.
  offset: number;
  returned: number;
  // Length of the whole text.
  total: number;
  hasMore: boolean;
  // Where the next piece starts; null when `text` reaches the end.
  nextOffset: number | null;
  // Only for an offset at or past the end of a text that is not empty: says
  // so, as the empty piece alone could be taken for an empty section.
  notice?: string;
  // Only for an offset past the end: the offset as asked for, as `offset`
  // is then the end.
  requestedOffset?: number;
}

// The piece of `text` from `offset` on, at most `limit` characters (no
// limit: up to the end). A piece that does not reach the end is cut after
// the last line break inside the limit, so lines stay whole; only a single
// line longer than the limit is cut inside the line (a limit shorter than
// the line cuts it; the next piece goes on inside it). An offset at or past
// the end gives an empty piece and a note (past the end: with the offset
// as requested).
export function textChunk(text: string, offset = 0, limit?: number): TextChunk {
  const total = countCodePoints(text);
  const start = Math.min(Math.max(offset, 0), total);
  const [from, to] = toCodeUnitOffsets(text, [
    start,
    limit === undefined ? total : Math.min(start + limit, total),
  ]) as [number, number];
  let piece = text.slice(from, to);
  const reachesEnd = to >= text.length;
  if (!reachesEnd) {
    const lineEnd = piece.lastIndexOf("\n");
    if (lineEnd >= 0) piece = piece.slice(0, lineEnd + 1);
  }
  const returned = countCodePoints(piece);
  const hasMore = start + returned < total;
  const chunk: TextChunk = {
    text: piece,
    offset: start,
    returned,
    total,
    hasMore,
    nextOffset: hasMore ? start + returned : null,
  };
  if (offset > 0 && offset >= total) {
    chunk.notice =
      offset === total
        ? `offset is at the end (total ${total}); nothing is left to read.`
        : `offset is past the end (total ${total}); nothing is left to read.`;
    if (offset > total) chunk.requestedOffset = offset;
  }
  return chunk;
}
