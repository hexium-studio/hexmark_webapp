import { closeSync, openSync, writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { createAnsiStripper } from "./ansi.ts";

// Writing console output to a log file as plain text, while it still goes to
// the terminal unchanged. Writes are synchronous so that the file is complete
// even when the process exits right after a failure.

export interface LogSink {
  // One stream of output (stdout or stderr) into the file; each keeps its own
  // state for escape sequences and characters cut between two chunks.
  stream(): (chunk: string | Uint8Array) => void;
  close(): void;
}

export function openLogSink(file: string): LogSink {
  const fd = openSync(file, "a");
  let open = true;
  const flushers: (() => string)[] = [];
  const write = (text: string) => {
    if (open && text) writeSync(fd, text);
  };
  return {
    stream() {
      const decoder = new StringDecoder("utf8");
      const stripper = createAnsiStripper();
      flushers.push(() => stripper.push(decoder.end()) + stripper.flush());
      return (chunk) => {
        write(stripper.push(typeof chunk === "string" ? chunk : decoder.write(chunk)));
      };
    },
    close() {
      if (!open) return;
      for (const flush of flushers) write(flush());
      open = false;
      closeSync(fd);
    },
  };
}

// Copies everything this process writes to stdout and stderr into `file`
// until the process exits. Used by a suite started on its own; under
// tools/run-checks.mjs the runner keeps the log of each step instead.
export function teeProcessOutput(file: string): void {
  const sink = openLogSink(file);
  for (const target of [process.stdout, process.stderr]) {
    const copy = sink.stream();
    const original = target.write.bind(target) as (...args: unknown[]) => boolean;
    target.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      copy(chunk);
      return original(chunk, ...rest);
    }) as typeof target.write;
  }
  process.once("exit", () => sink.close());
}
