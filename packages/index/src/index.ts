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
export {
  findConfigDrift,
  type ConfigDrift,
  type DeclaredDependency,
  type DuplicateDependency,
  type EnvExampleEntry,
  type SourceLine,
  type UndocumentedEnvVar,
} from "#src/config-drift";
export {
  conventionCounts,
  conventionSentence,
  MIN_MAJORITY,
  type ConventionCount,
} from "#src/conventions";
export { nodesInCycles } from "#src/cycles";
export {
  changedNames,
  docLinesMentioning,
  type ChangedNames,
  type DocLineMention,
} from "#src/doc-mentions";
export {
  isDocPath,
  readDoc,
  resolveDocLink,
  type DocLink,
  type DocMention,
  type IndexedDoc,
  type LinkDestination,
  type MentionKind,
} from "#src/docs";
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
  computeImpact,
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
  type ImportResolution,
  type LanguageCoverage,
} from "#src/languages";
export { type LintConfig } from "#src/lint-config";
export {
  parseWorkspaceYamlPackages,
  type PackageManifest,
  type PathAlias,
} from "#src/manifests";
export { coveredSourcePaths } from "#src/pairing";
export {
  patchLines,
  type PatchedFile,
  type PatchLine,
  type PatchLines,
} from "#src/patch-lines";
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
  type ResolvedImport,
} from "#src/resolve";
export { classifyFileRole, ROLE_PRECEDENCE, type FileRole } from "#src/roles";
export {
  governs,
  isRuleDoc,
  type RuleDoc,
} from "#src/rule-docs";
export { siblingsOf } from "#src/siblings";
export {
  readWorkspace,
  type WorkspaceModel,
  type WorkspacePackage,
} from "#src/workspace";
