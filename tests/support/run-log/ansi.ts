// Removes terminal escape sequences (colours, cursor movement, hyperlinks)
// from output written to log files. Plain TypeScript without dependencies:
// tools/run-checks.mjs loads it through Node's type stripping.

// CSI (ESC [ ... final), OSC (ESC ] ... BEL or ESC \) and the short
// two-character sequences (ESC followed by one byte, optionally after
// intermediate bytes).
const COMPLETE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-Z\\^-~])/g;

// The start of a sequence that the next chunk of a stream may complete.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
const PARTIAL = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*\x1b?|[ -/]*)$/;

// A sequence left open for this long is not one; it is written out as text.
const MAX_CARRY = 4096;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a lone escape byte left over
const LONE_ESCAPE = /\x1b/g;

export function stripAnsi(text: string): string {
  return text.replace(COMPLETE, "").replace(LONE_ESCAPE, "");
}

export interface AnsiStripper {
  // Returns the text of `chunk` without escape sequences. A sequence cut off
  // at the end of the chunk is held back until the next call.
  push(chunk: string): string;
  // Returns what was held back (without the incomplete sequence's escape byte).
  flush(): string;
}

export function createAnsiStripper(): AnsiStripper {
  let carry = "";
  return {
    push(chunk) {
      const text = carry + chunk;
      const partial = PARTIAL.exec(text);
      if (partial && text.length - partial.index <= MAX_CARRY) {
        carry = text.slice(partial.index);
        return stripAnsi(text.slice(0, partial.index));
      }
      carry = "";
      return stripAnsi(text);
    },
    flush() {
      const rest = stripAnsi(carry);
      carry = "";
      return rest;
    },
  };
}
