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
  findCodeowners,
  ownersOf,
  parseCodeowners,
  type CodeownersRule,
} from "#src/codeowners";
export { nodesInCycles } from "#src/cycles";
export {
  collectEntryPoints,
  isEntryPoint,
  type EntryPoints,
} from "#src/entry-points";
export {
  findReferences,
  findReferencesDescription,
  indexHeader,
  MAX_REFERENCE_FILES,
  renderFindReferences,
  UNINDEXED_PATH_REASON,
  unknownPath,
  type FindReferencesQuery,
  type FindReferencesResult,
  type IndexHeader,
  type KnownReferences,
  type UnknownReferences,
} from "#src/find-references";
export {
  resolveHeadImports,
  type HeadImport,
  type HeadTree,
} from "#src/head-imports";
export {
  computeImpact,
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_FILES,
  type BrokenImport,
  type Impact,
  type ImpactChange,
  type ImpactCounts,
  type ImpactHub,
} from "#src/impact";
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
  decodeRepositoryGraph,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
  type RepositoryGraphSnapshot,
  type SnapshotEdge,
} from "#src/snapshot";
export {
  createImportResolver,
  isRelativeSpecifier,
  moduleCandidates,
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
