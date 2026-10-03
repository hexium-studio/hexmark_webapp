// Pure rules of the code input: which characters a cell accepts and how
// typed or pasted text lands in the cells. No React, no DOM.

// One entry per cell; "" marks an empty cell.
export type CodeValue = readonly string[];

export interface CodeRules {
  length: number;
  // Tests one character after normalise().
  allowed: RegExp | ((char: string) => boolean);
  // Applied to every character before the test, e.g. upper-casing.
  normalise?: (char: string) => string;
}

export function emptyCode(length: number): string[] {
  return Array.from({ length }, () => "");
}

function isAllowed(rules: CodeRules, char: string): boolean {
  if (typeof rules.allowed === "function") return rules.allowed(char);
  rules.allowed.lastIndex = 0;
  return rules.allowed.test(char);
}

// Normalises text and keeps only the characters the cells accept, in order.
// Spaces, dashes and anything else invalid are dropped, so "abcd-efgh" and
// "ABCD EFGH" give the same result.
export function acceptedChars(text: string, rules: CodeRules): string[] {
  const chars: string[] = [];
  for (const raw of text) {
    const char = rules.normalise ? rules.normalise(raw) : raw;
    // A character may normalise to several ("ß" -> "SS"); a cell holds one.
    if ([...char].length === 1 && isAllowed(rules, char)) chars.push(char);
  }
  return chars;
}

// A stored value (e.g. a token verified earlier) as cells.
export function codeFromText(text: string | undefined, rules: CodeRules): string[] {
  const cells = emptyCode(rules.length);
  acceptedChars(text ?? "", rules)
    .slice(0, rules.length)
    .forEach((char, index) => {
      cells[index] = char;
    });
  return cells;
}

export function filledCount(code: CodeValue): number {
  return code.filter((char) => char !== "").length;
}

export interface Insertion {
  code: string[];
  // Cell that should receive focus afterwards.
  focusIndex: number;
}

// Writes `chars` into the cells starting at `index`; what does not fit is
// dropped. A complete code (exactly `length` characters) replaces all cells
// wherever it was pasted, because it can only mean the whole code.
export function insertChars(code: CodeValue, index: number, chars: string[]): Insertion {
  const length = code.length;
  if (chars.length === length) return { code: [...chars], focusIndex: length - 1 };
  const next = [...code];
  const fitting = chars.slice(0, length - index);
  fitting.forEach((char, offset) => {
    next[index + offset] = char;
  });
  return { code: next, focusIndex: Math.min(index + fitting.length, length - 1) };
}

export function clearCell(code: CodeValue, index: number): string[] {
  const next = [...code];
  next[index] = "";
  return next;
}

// What was typed into a cell that showed `shown` and now holds `value`:
// the caret may have been before or after the old character, or the old
// character may have been selected and replaced.
export function typedText(shown: string, value: string): string {
  if (shown === "") return value;
  if (value.startsWith(shown)) return value.slice(shown.length);
  if (value.endsWith(shown)) return value.slice(0, -shown.length);
  return value;
}

// What a key press in cell `index` does, for keys the cells handle
// themselves; null leaves the key to the browser. `code` is the new value
// (if it changes), `focus` the cell that receives focus (if it moves).
export interface KeyCommand {
  code?: string[];
  focus?: number;
}

export function keyCommand(
  code: CodeValue,
  index: number,
  key: string,
  rules: CodeRules,
  masked: boolean,
): KeyCommand | null {
  const last = code.length - 1;
  const clamp = (target: number) => Math.min(Math.max(target, 0), last);
  // Typing the character a revealed cell already shows leaves the input
  // unchanged, so no change event follows and focus would stay put while
  // the rest of the code lands one cell too early. Handled as if typed: focus
  // moves on and the (equal) value is reported as a change, so whatever a
  // change resets (e.g. the red state of a rejected code) is reset here too,
  // as it is for masked cells, whose input is empty and does change.
  if (!masked && key.length === 1 && acceptedChars(key, rules)[0] === code[index]) {
    return { code: [...code], focus: clamp(index + 1) };
  }
  const moves: Record<string, number> = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    Home: 0,
    End: last,
  };
  const target = moves[key];
  if (target !== undefined) return { focus: clamp(target) };
  if (key === "Backspace") {
    // A filled cell is cleared; an empty one clears the previous cell.
    if (code[index]) return { code: clearCell(code, index) };
    if (index > 0) return { code: clearCell(code, index - 1), focus: index - 1 };
    return {};
  }
  if (key === "Delete") return { code: clearCell(code, index) };
  return null;
}
