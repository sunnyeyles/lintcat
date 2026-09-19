/** How each ecosystem spells a test file's name, and the source name it points
 * at. One home, so classification and pairing can never disagree. */

/** `foo.test.ts`, `foo.spec.tsx`, `review-quality.eval.ts`. */
const DOTTED = /\.(test|spec|eval)\.[cm]?[jt]sx?$/;

/** Go, Python and Ruby spell it the other way round. */
const AFFIXED = /(^test_.+\.py|_test\.(go|py|rb))$/;

/** True for a lowercased base name written to any of those conventions. */
export function isTestBasename(base: string): boolean {
  return DOTTED.test(base) || AFFIXED.test(base);
}

const DOTTED_SUBJECT = /^(.+)\.(?:test|spec|eval)\.([^.]+)$/;
const SUFFIXED_SUBJECT = /^(.+)_test\.(go|py|rb)$/;
const PREFIXED_SUBJECT = /^test_(.+)\.(py)$/;

/** The stem and extension of the source a test's own base name names. */
export function testSubject(
  base: string,
): { stem: string; extension: string } | undefined {
  const matched =
    DOTTED_SUBJECT.exec(base) ??
    SUFFIXED_SUBJECT.exec(base) ??
    PREFIXED_SUBJECT.exec(base);
  return matched === null
    ? undefined
    : { stem: matched[1]!, extension: matched[2]! };
}
