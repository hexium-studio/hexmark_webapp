// Splits a stream of output chunks into whole lines. A chunk may end in the
// middle of a line (or of a multi-byte character); that part is held back
// until the rest arrives. `flush` returns what is left once the stream ends.

export interface LineSplitter {
  push(chunk: Buffer | string): string[];
  flush(): string[];
}

export function lineSplitter(): LineSplitter {
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  const split = (text: string): string[] => {
    const parts = (pending + text).split(/\r?\n/);
    pending = parts.pop() ?? "";
    return parts;
  };
  return {
    push(chunk) {
      return split(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    },
    flush() {
      const rest = pending + decoder.decode();
      pending = "";
      return rest === "" ? [] : [rest];
    },
  };
}
