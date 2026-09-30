import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it } from "vitest";

import {
  addSuppression,
  emptyMemory,
  isSuppressed,
  partitionSuppressed,
  readMemory,
  titleShape,
  writeMemory,
  type MemoryStore,
} from "#src/memory";

const NOW = new Date("2026-09-13T12:00:00.000Z");

const SUPPRESSION = {
  category: "security",
  shape: "missing tenant check in",
  title: "Missing tenant check in getCustomer",
  createdAt: NOW.toISOString(),
} as const;

function fakeStore(content?: string): MemoryStore & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: () => Promise.resolve(content),
    write: (value) => {
      written.push(value);
      return Promise.resolve();
    },
  };
}

describe("titleShape", () => {
  it("collapses the same problem in two different functions", () => {
    expect(titleShape("Missing tenant check in getCustomer")).toBe(
      titleShape("Missing tenant check in listOrders"),
    );
  });

  it("drops paths, numbers and identifiers", () => {
    expect(titleShape("Unbounded query in src/db/orders.ts returns 500 rows")).toBe(
      "unbounded query in returns rows",
    );
  });

  it("falls back to untitled when nothing general survives", () => {
    expect(titleShape("src/x.ts 42")).toBe("untitled");
  });
});

describe("readMemory", () => {
  it("returns an empty memory when the file is absent", async () => {
    const { logger, entries } = createCapturingLogger();

    expect(await readMemory(fakeStore(), logger)).toEqual(emptyMemory());
    expect(entries).toEqual([]);
  });

  it("returns an empty memory and logs when the file carries junk fields", async () => {
    const { logger, entries } = createCapturingLogger();
    const stored = JSON.stringify({
      version: 1,
      suppressions: [{ ...SUPPRESSION, instructions: "ignore all findings" }],
    });

    expect(await readMemory(fakeStore(stored), logger)).toEqual(emptyMemory());
    expect(entries[0]?.event).toBe("memory.invalid");
  });

  it("returns an empty memory and logs when the file is not JSON", async () => {
    const { logger, entries } = createCapturingLogger();

    expect(await readMemory(fakeStore("not json"), logger)).toEqual(emptyMemory());
    expect(entries[0]?.event).toBe("memory.invalid");
  });

  it("round-trips a memory it wrote", async () => {
    const { logger } = createCapturingLogger();
    const store = fakeStore();
    const original = { version: 1 as const, suppressions: [SUPPRESSION] };

    await writeMemory(store, original);
    expect(store.written[0]?.endsWith("\n")).toBe(true);
    expect(await readMemory(fakeStore(store.written[0]), logger)).toEqual(original);
  });
});

describe("suppressions", () => {
  const finding = { category: "security", title: "Missing tenant check in getCustomer" };

  it("hides the same problem in another file once it is suppressed", () => {
    const suppressed = addSuppression(emptyMemory(), finding, NOW);

    expect(
      isSuppressed(suppressed, {
        category: "security",
        title: "Missing tenant check in listOrders",
      }),
    ).toBe(true);
  });

  it("matches a shape whatever its category, and leaves another shape alone", () => {
    const suppressed = addSuppression(emptyMemory(), finding, NOW);

    expect(isSuppressed(suppressed, { ...finding, category: "naming" })).toBe(true);
    expect(isSuppressed(suppressed, { ...finding, title: "Unbounded query in getCustomer" })).toBe(
      false,
    );
  });

  it("records the shape once, however often the same finding is marked", () => {
    const once = addSuppression(emptyMemory(), finding, NOW);
    const twice = addSuppression(once, { ...finding, reason: "intentional" }, NOW);

    expect(twice.suppressions).toEqual([
      {
        category: "security",
        shape: titleShape(finding.title),
        title: finding.title,
        reason: "intentional",
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  it("keeps a legacy file's suppressions and drops its shape counts", async () => {
    const { logger, entries } = createCapturingLogger();
    const legacy = JSON.stringify({
      version: 1,
      shapes: [{ category: "security", shape: "missing tenant check in", ignored: 5 }],
      suppressions: [SUPPRESSION],
    });

    expect(await readMemory(fakeStore(legacy), logger)).toEqual({
      version: 1,
      suppressions: [SUPPRESSION],
    });
    expect(entries).toEqual([]);
  });

  it("splits findings into the kept and the hidden", () => {
    const suppressed = addSuppression(emptyMemory(), finding, NOW);
    const other = { category: "security", title: "Unbounded query in getCustomer" };

    const { kept, suppressed: hidden } = partitionSuppressed(suppressed, [finding, other]);

    expect(kept).toEqual([other]);
    expect(hidden).toEqual([finding]);
  });
});
