/**
 * The in-memory repository index: file roles, test-to-source pairing and
 * per-language coverage, built from the files at a pull request's base commit.
 */
export {
  buildRepositoryIndex,
  type IndexedFile,
  type RepositoryIndex,
  type RepositoryIndexInput,
} from "#src/build";
export {
  languageOf,
  summariseLanguages,
  type LanguageCoverage,
} from "#src/languages";
export { coveredSourcePaths } from "#src/pairing";
export { classifyFileRole, ROLE_PRECEDENCE, type FileRole } from "#src/roles";
