import { classifyFileRole } from "@pr-review/index";

const TEST_DATA_DIRECTORIES = new Set(["fixtures", "__fixtures__", "testdata", "__snapshots__", "snapshots"]);

/** Tests and the data beside them, by path convention only. */
export function isTestPath(file: string): boolean {
  if (classifyFileRole(file) === "test") return true;
  return file.split("/").slice(0, -1).some((segment) => TEST_DATA_DIRECTORIES.has(segment));
}
