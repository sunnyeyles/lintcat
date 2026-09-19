/**
 * The in-memory repository index: file roles, test-to-source pairing, the
 * import graph and per-language coverage, at a pull request's base commit.
 */
export {
  buildRepositoryIndex,
  type ImportEdge,
  type IndexedFile,
  type RepositoryIndex,
  type RepositoryIndexInput,
} from "#src/build";
export {
  parseImports,
  type ImportedName,
  type ImportKind,
  type ParsedImport,
} from "#src/imports";
export {
  INDEXED_LANGUAGES,
  languageOf,
  summariseLanguages,
  type ImportResolution,
  type LanguageCoverage,
} from "#src/languages";
export {
  parseWorkspaceYamlPackages,
  readPathAliases,
  type PackageManifest,
  type PathAlias,
} from "#src/manifests";
export { coveredSourcePaths } from "#src/pairing";
export {
  referencesTo,
  type Reference,
  type ReferenceImport,
} from "#src/references";
export {
  createImportResolver,
  isRelativeSpecifier,
  resolveRelativeImport,
  type ResolvedImport,
} from "#src/resolve";
export { classifyFileRole, ROLE_PRECEDENCE, type FileRole } from "#src/roles";
export {
  packageOf,
  readWorkspace,
  type WorkspaceModel,
  type WorkspacePackage,
} from "#src/workspace";
