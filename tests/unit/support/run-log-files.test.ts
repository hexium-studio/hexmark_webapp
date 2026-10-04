import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAnsiStripper, stripAnsi } from "../../support/run-log/ansi.ts";
import { vitestLabel } from "../../support/run-log/config.ts";
import { openLogSink } from "../../support/run-log/output.ts";
import {
  createRunDir,
  pruneRuns,
  runDirName,
  slug,
  stepLogFile,
  stepReportFile,
} from "../../support/run-log/run-dir.ts";

// The run directory helpers behind tools/run-checks.mjs and the test configs:
// escape sequences out of logs, names, creating and pruning run directories.

const ESC = "\x1b";

describe("stripAnsi", () => {
  it("removes colours, cursor movement and hyperlinks and keeps the text", () => {
    const text = `${ESC}[1m${ESC}[31mFAIL${ESC}[39m${ESC}[22m a > b ${ESC}[2K${ESC}[1A${ESC}[G`;
    expect(stripAnsi(text)).toBe("FAIL a > b ");
    expect(stripAnsi(`${ESC}]8;;https://x.test${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe("link");
    expect(stripAnsi(`${ESC}]0;title\x07after`)).toBe("after");
    expect(stripAnsi(`${ESC}7saved${ESC}8`)).toBe("saved");
  });

  it("leaves text without escape sequences unchanged, umlauts and emoji included", () => {
    const text = "✓ tests/unit/a.test.ts (3 tests) 12ms\nÄrger 😀 [31m\n";
    expect(stripAnsi(text)).toBe(text);
  });
});

describe("createAnsiStripper", () => {
  it("holds back a sequence cut between two chunks", () => {
    const stripper = createAnsiStripper();
    expect(stripper.push(`red: ${ESC}[3`)).toBe("red: ");
    expect(stripper.push(`1mtext${ESC}`)).toBe("text");
    expect(stripper.push(`[0m done`)).toBe(" done");
    expect(stripper.flush()).toBe("");
  });

  it("writes out a sequence that never ends, without its escape byte", () => {
    const stripper = createAnsiStripper();
    expect(stripper.push(`end ${ESC}[`)).toBe("end ");
    expect(stripper.flush()).toBe("[");
  });
});

describe("openLogSink", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hexmark-run-log-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes plain text, joins characters cut between buffers, keeps streams apart", () => {
    const file = join(dir, "step.log");
    const sink = openLogSink(file);
    const out = sink.stream();
    const err = sink.stream();
    const umlaut = Buffer.from("Ä", "utf8");
    out(Buffer.concat([Buffer.from(`${ESC}[32mok${ESC}[39m `), umlaut.subarray(0, 1)]));
    err(`${ESC}[31merror${ESC}`);
    out(Buffer.concat([umlaut.subarray(1), Buffer.from("\n")]));
    err("[39m\n");
    sink.close();
    sink.close();
    expect(readFileSync(file, "utf8")).toBe("ok errorÄ\n\n");
  });
});

describe("run directory names", () => {
  it("are the UTC time and the label, sortable and safe as file names", () => {
    const now = new Date("2026-10-04T09:15:02.345Z");
    expect(runDirName(now, "pre-push")).toBe("2026-10-04T09-15-02Z-pre-push");
    expect(runDirName(now, "test:unit")).toBe("2026-10-04T09-15-02Z-test-unit");
    expect(slug("check:translations")).toBe("check-translations");
    expect(slug("::")).toBe("run");
    expect(stepLogFile("/r", "test:e2e")).toBe(join("/r", "test-e2e.log"));
    expect(stepReportFile("/r", "test:e2e")).toBe(join("/r", "test-e2e.report.json"));
  });

  it("name a Vitest run after its projects", () => {
    expect(vitestLabel(["node", "vitest", "run", "--project", "unit"])).toBe("test-unit");
    expect(vitestLabel(["node", "vitest", "run", "--project=integration"])).toBe(
      "test-integration",
    );
    expect(vitestLabel(["node", "vitest", "run", "tests/unit/a.test.ts"])).toBe("test");
  });
});

describe("createRunDir and pruneRuns", () => {
  let runs: string;
  beforeEach(() => {
    runs = mkdtempSync(join(tmpdir(), "hexmark-runs-"));
  });
  afterEach(() => rmSync(runs, { recursive: true, force: true }));

  it("gives a second run in the same second its own directory", () => {
    const now = new Date("2026-10-04T09:15:02Z");
    const first = createRunDir("all", now, runs);
    const second = createRunDir("all", now, runs);
    expect(first).toBe(join(runs, "2026-10-04T09-15-02Z-all"));
    expect(second).toBe(join(runs, "2026-10-04T09-15-02Z-all-2"));
  });

  it("keeps the newest runs and leaves everything else alone", () => {
    const names = Array.from({ length: 6 }, (_, i) => `2026-10-0${i + 1}T10-00-00Z-all`);
    for (const name of [...names].reverse()) {
      mkdirSync(join(runs, name));
      writeFileSync(join(runs, name, "summary.json"), "{}");
    }
    mkdirSync(join(runs, "keep-me"));
    writeFileSync(join(runs, "2026-10-01T00-00-00Z-a-file"), "");

    expect(pruneRuns(runs, 4)).toEqual(names.slice(0, 2));
    expect(readdirSync(runs).sort()).toEqual(
      ["2026-10-01T00-00-00Z-a-file", ...names.slice(2), "keep-me"].sort(),
    );
    expect(pruneRuns(runs, 4)).toEqual([]);
    expect(readdirSync(runs)).toHaveLength(6);
  });

  it("does nothing when there is no runs directory yet", () => {
    expect(pruneRuns(join(runs, "missing"), 1)).toEqual([]);
  });
});
