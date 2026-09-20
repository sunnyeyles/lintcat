/** Fixture loading, and the line numbers every expectation anchor depends on. */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadFixture } from "#src/fixture";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const fixtureNames = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

function toLines(text: string): string[] {
  return text === "" ? [] : text.slice(0, -1).split("\n");
}

/** Walks a patch's hunks, asserting each line sits where its header says. */
function checkLineNumbers(patch: string, baseText: string, headText: string): void {
  const baseLines = toLines(baseText);
  const headLines = toLines(headText);
  let baseLine = 0;
  let headLine = 0;
  for (const line of patch === "" ? [] : patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      baseLine = Number(header[1]);
      headLine = Number(header[3]);
      continue;
    }
    const text = line.slice(1);
    if (!line.startsWith("+")) {
      expect(baseLines[baseLine - 1]).toBe(text);
      baseLine += 1;
    }
    if (!line.startsWith("-")) {
      expect(headLines[headLine - 1]).toBe(text);
      headLine += 1;
    }
  }
}

describe("loadFixture", () => {
  it("finds at least one fixture to check", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  it.each(fixtureNames)("loads %s", (name) => {
    const fixture = loadFixture(name);

    expect(fixture.name).toBe(name);
    expect(fixture.manifest.name).toBe(name);
    expect(fixture.context.owner).toBe(fixture.manifest.owner);
    expect(fixture.context.repo).toBe(fixture.manifest.repo);
    expect(fixture.pullRequest.baseSha).toBe(fixture.manifest.baseSha);
    expect(fixture.pullRequest.headSha).toBe(fixture.manifest.headSha);
    expect(fixture.headFiles.size).toBeGreaterThan(0);
    expect(fixture.changedFiles).toHaveLength(fixture.manifest.changedFiles.length);
  });

  it.each(fixtureNames)("builds %s's patches at the right line numbers", (name) => {
    const fixture = loadFixture(name);

    for (const file of fixture.changedFiles) {
      const headText = fixture.headFiles.get(file.filename);
      expect(headText).toBeDefined();
      const baseText = file.status === "added" ? "" : fixture.baseFiles.get(file.filename);
      expect(baseText).toBeDefined();
      expect(file.patch).toBeDefined();
      checkLineNumbers(file.patch ?? "", baseText ?? "", headText ?? "");
    }
  });

  it.each(fixtureNames)("separates %s's base tree from its head tree", (name) => {
    const fixture = loadFixture(name);
    const changed = new Map(
      fixture.manifest.changedFiles.map((file) => [file.path, file.status]),
    );

    for (const [path, contents] of fixture.headFiles) {
      const status = changed.get(path);
      if (status === "added") {
        expect(fixture.baseFiles.has(path)).toBe(false);
      } else if (status === "modified") {
        expect(fixture.baseFiles.get(path)).not.toBe(contents);
      } else {
        expect(fixture.baseFiles.get(path)).toBe(contents);
      }
    }
  });

  it.each(fixtureNames)("counts %s's additions and deletions from its patch", (name) => {
    for (const file of loadFixture(name).changedFiles) {
      const lines = (file.patch ?? "").split("\n");
      expect(file.additions).toBe(lines.filter((line) => line.startsWith("+")).length);
      expect(file.deletions).toBe(lines.filter((line) => line.startsWith("-")).length);
    }
  });

  it.each(fixtureNames)("gives %s a diff covering every changed file", (name) => {
    const fixture = loadFixture(name);

    for (const file of fixture.changedFiles) {
      expect(fixture.diff).toContain(`diff --git a/${file.filename} b/${file.filename}`);
      expect(fixture.diff).toContain(
        file.status === "added" ? "--- /dev/null" : `--- a/${file.filename}`,
      );
    }
    expect(fixture.context.diff).toBe(fixture.diff);
  });

  it("covers both an added and a modified file across the fixture set", () => {
    const statuses = new Set(
      fixtureNames.flatMap((name) =>
        loadFixture(name).manifest.changedFiles.map((file) => file.status),
      ),
    );

    expect([...statuses].sort()).toEqual(["added", "modified"]);
  });

  it("refuses a fixture directory that does not exist", () => {
    expect(() => loadFixture("no-such-fixture")).toThrow(
      new RegExp(`ENOENT.*${join(FIXTURES_DIR, "no-such-fixture", "fixture.json")}`),
    );
  });
});
