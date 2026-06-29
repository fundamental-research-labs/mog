import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format as formatWithPrettier, resolveConfig as resolvePrettierConfig } from 'prettier';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(packageRoot, '../..');
const specPath = resolve(repoRoot, 'runtime/sdk/src/generated/api-spec.json');
const publicWorkbookVersionContractPath = resolve(
  repoRoot,
  'types/api/src/api/workbook/version-workbook.ts',
);
const outPath = resolve(packageRoot, 'src/workbook-facade-capability-matrix.ts');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const checkMode = process.argv.includes('--check');

const DENY = new Set([
  '[Symbol.asyncDispose]',
  'activePrincipal',
  'close',
  'dispose',
  'emit',
  'executeCode',
  'makePrincipal',
  'markClean',
  'on',
  'save',
  'securityActive',
  'setActivePrincipal',
]);

const ROUTE_EXPORT = new Set(['toXlsx']);
const ROUTE_SCREENSHOT = new Set(['captureScreenshot']);
const UNDO_GROUP = new Set(['undoGroup', 'batch']);
const POLICY_ADMIN_INTERFACES = new Set(['WorkbookSecurity']);
const EXPORT_NAMES = new Set(['toCSV', 'toJSON']);
const READ_NAMES = new Set(['autoFillPreview']);
const WRITE_NAMES = new Set(['getOrCreateSheet']);
const REVIEW_ID_SUPPLIED_CONDITION = {
  argumentIndex: 0,
  path: ['reviewId'],
  presence: 'present',
};
const VERSION_METHOD_REQUIREMENTS = {
  getStatus: ['version:read'],
  getSurfaceStatus: [],
  getCurrent: ['version:read'],
  getHead: ['version:read'],
  listCommits: ['version:read'],
  diff: ['version:diff'],
  diffOverview: ['version:diff'],
  diffGroupDetail: ['version:diff'],
  diffWorkingTree: ['version:diff'],
  commit: ['version:commit'],
  checkout: ['version:checkout'],
  merge: ['version:mergePreview'],
  applyMerge: ['version:mergePreview', 'version:mergeApply', 'version:branch'],
  revert: ['version:revert'],
  listBranches: ['version:read'],
  diffCurrent: ['version:diff'],
  diffCurrentOverview: ['version:diff'],
  diffBranch: ['version:diff'],
  diffBranchOverview: ['version:diff'],
  commitCurrent: ['version:commit'],
  checkoutBranch: ['version:checkout'],
  checkoutCommit: ['version:checkout'],
  createBranchFromCurrent: ['version:read', 'version:branch'],
  previewMerge: ['version:mergePreview'],
  getMergeReview: ['version:mergePreview'],
};
const VERSION_REFS_METHOD_REQUIREMENTS = {
  readRef: ['version:read'],
  getRef: ['version:read'],
  listRefs: ['version:read'],
  promotePendingRemote: ['version:remotePromote', 'version:provenance'],
  createBranch: ['version:branch'],
  fastForwardBranch: ['version:branch'],
  updateBranch: ['version:branch'],
  deleteBranch: ['version:branch'],
  deleteRef: ['version:branch'],
};
const VERSION_REVIEW_ADVANCED_METHOD_REQUIREMENTS = {
  listReviews: ['version:reviewRead'],
  getReview: ['version:reviewRead'],
  createReview: ['version:reviewWrite'],
  appendReviewDecision: ['version:reviewWrite'],
  updateReviewStatus: ['version:reviewWrite'],
  getReviewDiff: {
    capabilities: ['version:diff'],
    conditionalCapabilities: [
      {
        when: REVIEW_ID_SUPPLIED_CONDITION,
        capabilities: ['version:reviewRead'],
      },
    ],
  },
};
const VERSION_MERGE_ARTIFACT_ADVANCED_METHOD_REQUIREMENTS = {
  saveMergeResolutions: ['version:mergePreview', 'version:mergeApply'],
  getMergeConflictDetail: ['version:mergePreview'],
  putMergeResolutionPayload: ['version:mergePreview', 'version:mergeApply'],
};
const VERSION_PROPOSAL_METHOD_NAMES = new Set([
  'createProposal',
  'startProposalWorkspace',
  'getProposalWorkspace',
  'disposeProposalWorkspace',
  'commitProposalWorkspace',
  'failProposal',
  'getProposal',
  'listProposals',
  'markProposalVerified',
  'openProposalReview',
  'acceptProposal',
  'rejectProposal',
  'supersedeProposal',
]);
const VERSION_PROPOSAL_PORCELAIN_METHOD_REQUIREMENTS = {
  create: ['version:proposal'],
  get: ['version:proposal'],
  list: ['version:proposal'],
};
const VERSION_PROPOSAL_ADVANCED_METHOD_REQUIREMENTS = {
  createProposal: ['version:proposal'],
  startProposalWorkspace: ['version:proposal'],
  getProposalWorkspace: ['version:proposal'],
  disposeProposalWorkspace: ['version:proposal'],
  commitProposalWorkspace: ['version:proposal'],
  failProposal: ['version:proposal'],
  getProposal: ['version:proposal'],
  listProposals: ['version:proposal'],
  markProposalVerified: ['version:proposal'],
  openProposalReview: ['version:proposal'],
  acceptProposal: ['version:proposal', 'version:mergePreview', 'version:mergeApply'],
  rejectProposal: ['version:proposal'],
  supersedeProposal: ['version:proposal'],
};
const VERSION_PROPOSAL_HANDLE_METHOD_REQUIREMENTS = {
  refresh: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalHandle'],
    returnsVersionResult: true,
  },
  openWorkspace: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalWorkspaceHandle'],
    returnsVersionResult: true,
  },
  markVerified: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalHandle'],
    returnsVersionResult: true,
  },
  markReadyForReview: {
    capabilities: ['version:proposal'],
    returnsVersionResult: true,
  },
  accept: {
    capabilities: ['version:proposal', 'version:mergePreview', 'version:mergeApply'],
    returnsVersionResult: true,
  },
  reject: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalHandle'],
    returnsVersionResult: true,
  },
  supersede: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalHandle'],
    returnsVersionResult: true,
  },
};
const VERSION_PROPOSAL_WORKSPACE_HANDLE_METHOD_REQUIREMENTS = {
  workbook: {
    capabilities: ['version:proposal'],
    returns: ['Workbook'],
  },
  commit: {
    capabilities: ['version:proposal'],
    returns: ['VersionProposalHandle'],
    returnsVersionResult: true,
  },
  dispose: {
    capabilities: ['version:proposal'],
    returnsVersionResult: true,
  },
};
const VERSION_MERGE_REVIEW_METHOD_REQUIREMENTS = {
  choose: {
    capabilities: ['version:mergePreview'],
    returns: ['VersionMergeReview'],
  },
  chooseAll: {
    capabilities: ['version:mergePreview'],
    returns: ['VersionMergeReview'],
  },
  save: {
    capabilities: ['version:mergePreview', 'version:mergeApply'],
    returnsVersionResult: true,
  },
  toApplyInput: ['version:mergePreview'],
  apply: {
    capabilities: ['version:mergePreview', 'version:mergeApply', 'version:branch'],
    returnsVersionResult: true,
  },
  getConflictDetail: {
    capabilities: ['version:mergePreview'],
    returnsVersionResult: true,
  },
};
const VERSION_SPEC_SUPPLEMENT_METHOD_NAMES = new Set([]);
const VERSION_METHOD_GROUPS = [];
const WRITE_PREFIXES = [
  'add',
  'apply',
  'autoFill',
  'clear',
  'copy',
  'create',
  'delete',
  'enable',
  'fill',
  'hide',
  'insert',
  'move',
  'refresh',
  'remove',
  'rename',
  'replace',
  'restore',
  'set',
  'show',
  'sort',
  'switch',
  'update',
  'write',
];

function versionMethodEntry(methodName) {
  const requirements = VERSION_METHOD_REQUIREMENTS[methodName];
  return capabilityEntry(requirements);
}

function capabilityEntry(requirements) {
  if (Array.isArray(requirements)) {
    return { capabilities: requirements };
  }
  return requirements;
}

function versionInterfaceRequirements(interfaceName) {
  if (interfaceName === 'WorkbookVersion') return VERSION_METHOD_REQUIREMENTS;
  if (interfaceName === 'WorkbookVersionRefsNamespace') return VERSION_REFS_METHOD_REQUIREMENTS;
  if (interfaceName === 'WorkbookVersionReviewApi') {
    return VERSION_REVIEW_ADVANCED_METHOD_REQUIREMENTS;
  }
  if (interfaceName === 'VersionMergeReviewArtifactApi') {
    return VERSION_MERGE_ARTIFACT_ADVANCED_METHOD_REQUIREMENTS;
  }
  if (interfaceName === 'VersionProposalPorcelainApi') {
    return VERSION_PROPOSAL_PORCELAIN_METHOD_REQUIREMENTS;
  }
  if (interfaceName === 'VersionProposalApi') return VERSION_PROPOSAL_ADVANCED_METHOD_REQUIREMENTS;
  if (interfaceName === 'VersionProposalHandle') return VERSION_PROPOSAL_HANDLE_METHOD_REQUIREMENTS;
  if (interfaceName === 'VersionProposalWorkspaceHandle') {
    return VERSION_PROPOSAL_WORKSPACE_HANDLE_METHOD_REQUIREMENTS;
  }
  if (interfaceName === 'VersionMergeReview') return VERSION_MERGE_REVIEW_METHOD_REQUIREMENTS;
  return null;
}

function versionInterfaceMethodEntry(interfaceName, methodName) {
  const requirements = versionInterfaceRequirements(interfaceName);
  if (!requirements) return null;
  if (!Object.hasOwn(requirements, methodName)) {
    throw new Error(`${interfaceName}.${methodName} is missing an explicit version capability`);
  }
  return capabilityEntry(requirements[methodName]);
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function publicWorkbookVersionMethodNames() {
  const methodNames = collectInterfaceMethodNames(
    publicWorkbookVersionContractPath,
    'WorkbookVersion',
    new Set(),
  );

  if (methodNames.size === 0) {
    throw new Error(
      `public WorkbookVersion contract has no methods in ${publicWorkbookVersionContractPath}`,
    );
  }

  return methodNames;
}

function collectInterfaceMethodNames(filePath, interfaceName, seen) {
  const key = `${filePath}:${interfaceName}`;
  if (seen.has(key)) return new Set();
  seen.add(key);

  const sourceFile = parseSourceFile(filePath);
  const importedInterfacePaths = importedTypePaths(sourceFile, filePath);
  const methodNames = new Set();
  let found = false;

  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = true;
      for (const member of node.members) {
        if (!ts.isMethodSignature(member)) continue;
        const name = propertyNameText(member.name);
        if (name) methodNames.add(name);
      }
      for (const baseName of interfaceBaseNames(node)) {
        const basePath = importedInterfacePaths.get(baseName) ?? filePath;
        for (const name of collectInterfaceMethodNames(basePath, baseName, seen)) {
          methodNames.add(name);
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!found) {
    throw new Error(`Unable to resolve public interface ${interfaceName} in ${filePath}`);
  }

  return methodNames;
}

function parseSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function importedTypePaths(sourceFile, filePath) {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith('.')) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const resolvedPath = resolveRelativeTypeScriptPath(filePath, statement.moduleSpecifier.text);
    for (const element of namedBindings.elements) {
      imports.set(element.name.text, resolvedPath);
    }
  }
  return imports;
}

function resolveRelativeTypeScriptPath(filePath, specifier) {
  const basePath = resolve(dirname(filePath), specifier);
  const candidates = [basePath, `${basePath}.ts`, resolve(basePath, 'index.ts')];
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(`Unable to resolve TypeScript import ${specifier} from ${filePath}`);
  }
  return resolvedPath;
}

function interfaceBaseNames(node) {
  const names = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) {
      if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
    }
  }
  return names;
}

function classify(interfaceName, methodName) {
  if (DENY.has(methodName)) {
    return {
      decision: 'deny',
      reason: 'raw lifecycle, event, security, persistence, or code execution bypass',
    };
  }
  if (POLICY_ADMIN_INTERFACES.has(interfaceName)) {
    return { decision: 'allow', capability: 'workbook:policy-admin' };
  }
  const versionEntry = versionInterfaceMethodEntry(interfaceName, methodName);
  if (versionEntry) {
    return { decision: 'allow', ...versionEntry };
  }
  if (ROUTE_EXPORT.has(methodName) || EXPORT_NAMES.has(methodName)) {
    return { decision: 'allow', capability: 'workbook:export' };
  }
  if (ROUTE_SCREENSHOT.has(methodName)) {
    return { decision: 'allow', capability: 'workbook:screenshot' };
  }
  if (UNDO_GROUP.has(methodName)) {
    return { decision: 'allow', capability: 'workbook:undo-group' };
  }
  if (methodName === 'calculate') {
    return { decision: 'allow', capability: 'workbook:write' };
  }
  if (READ_NAMES.has(methodName)) {
    return { decision: 'allow', capability: 'workbook:read' };
  }
  if (WRITE_NAMES.has(methodName)) {
    return { decision: 'allow', capability: 'workbook:write' };
  }
  if (WRITE_PREFIXES.some((prefix) => methodName.startsWith(prefix))) {
    return { decision: 'allow', capability: 'workbook:write' };
  }
  return { decision: 'allow', capability: 'workbook:read' };
}

function returnedInterfaces(signature) {
  const result = [];
  const interfaceNames = new Set([
    ...Object.keys(spec.interfaces),
    'VersionProposalHandle',
    'VersionProposalWorkspaceHandle',
    'VersionMergeReview',
  ]);
  for (const interfaceName of [...interfaceNames].sort()) {
    if (interfaceName === 'Workbook') continue;
    const pattern = new RegExp(`\\b${interfaceName}\\b`);
    if (pattern.test(signature)) result.push(interfaceName);
  }
  return result;
}

function returnsVersionResult(signature) {
  return /\bVersionResult\s*</.test(signature);
}

function generatedSubApiInterfaces() {
  const nested = {};
  for (const [interfaceName, interfaceSpec] of Object.entries(spec.interfaces)) {
    const entries = {};
    for (const [memberName, memberSpec] of Object.entries(interfaceSpec.members ?? {})) {
      if (!memberSpec.targetInterface) continue;
      entries[memberName] = memberSpec;
    }
    if (Object.keys(entries).length > 0) nested[interfaceName] = entries;
  }

  return {
    workbook: spec.subApis.workbook,
    worksheet: spec.subApis.worksheet,
    ...nested,
  };
}

function singleQuoted(value) {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

function formatKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : singleQuoted(key);
}

function formatValue(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const childPad = ' '.repeat(indent + 2);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (
      value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))
    ) {
      return `[${value.map((item) => formatValue(item, 0)).join(', ')}]`;
    }
    return `[\n${value
      .map((item) => `${childPad}${formatValue(item, indent + 2)},`)
      .join('\n')}\n${pad}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([key, child]) => `${childPad}${formatKey(key)}: ${formatValue(child, indent + 2)},`)
      .join('\n')}\n${pad}}`;
  }

  if (typeof value === 'string') {
    return singleQuoted(value);
  }

  return JSON.stringify(value);
}

const matrix = {};
for (const [interfaceName, interfaceSpec] of Object.entries(spec.interfaces)) {
  const entries = {};
  for (const [methodName, methodSpec] of Object.entries(interfaceSpec.functions ?? {})) {
    if (methodSpec.targetInterface) continue;
    entries[methodName] = {
      ...classify(interfaceName, methodName),
      ...(returnedInterfaces(methodSpec.signature).length > 0
        ? { returns: returnedInterfaces(methodSpec.signature) }
        : {}),
      ...(returnsVersionResult(methodSpec.signature) ? { returnsVersionResult: true } : {}),
    };
  }
  matrix[interfaceName] = entries;
}
for (const interfaceName of [
  'VersionProposalHandle',
  'VersionProposalWorkspaceHandle',
  'VersionMergeReview',
]) {
  matrix[interfaceName] = Object.fromEntries(
    Object.entries(versionInterfaceRequirements(interfaceName)).map(([methodName, requirement]) => [
      methodName,
      { decision: 'allow', ...capabilityEntry(requirement) },
    ]),
  );
}
for (const methodName of VERSION_SPEC_SUPPLEMENT_METHOD_NAMES) {
  if (!Object.hasOwn(VERSION_METHOD_REQUIREMENTS, methodName)) {
    throw new Error(
      `WorkbookVersion.${methodName} spec supplement is missing explicit version capability requirements`,
    );
  }
  if (matrix.WorkbookVersion[methodName]) {
    throw new Error(
      `WorkbookVersion.${methodName} no longer needs a workbook facade spec supplement`,
    );
  }
  matrix.WorkbookVersion[methodName] = {
    decision: 'allow',
    ...versionMethodEntry(methodName),
  };
}
matrix.WorkbookVersion = Object.fromEntries(
  Object.entries(matrix.WorkbookVersion).sort(([left], [right]) => left.localeCompare(right)),
);

function assertVersionCapabilityMatrix() {
  if (!spec.subApis.workbook.version) {
    throw new Error('api spec is missing subApis.workbook.version');
  }
  if (spec.subApis.workbook.version.targetInterface !== 'WorkbookVersion') {
    throw new Error('api spec subApis.workbook.version must target WorkbookVersion');
  }
  const versionMatrix = matrix.WorkbookVersion;
  if (!versionMatrix) {
    throw new Error('workbook facade capability matrix is missing WorkbookVersion');
  }
  const versionSpecMethods = Object.fromEntries(
    Object.entries(spec.interfaces.WorkbookVersion.functions ?? {}).filter(
      ([, methodSpec]) => !methodSpec.targetInterface,
    ),
  );
  const publicContractMethods = publicWorkbookVersionMethodNames();
  const versionSpecMethodNames = new Set(Object.keys(versionSpecMethods));

  for (const methodName of publicContractMethods) {
    if (!Object.hasOwn(VERSION_METHOD_REQUIREMENTS, methodName)) {
      throw new Error(
        `public WorkbookVersion.${methodName} is missing explicit version capability requirements`,
      );
    }
    if (
      !versionSpecMethodNames.has(methodName) &&
      !VERSION_SPEC_SUPPLEMENT_METHOD_NAMES.has(methodName)
    ) {
      throw new Error(
        `api spec is stale: public WorkbookVersion.${methodName} exists in types/api/src/api/workbook/version-workbook.ts but is missing from runtime/sdk/src/generated/api-spec.json`,
      );
    }
  }

  for (const methodName of versionSpecMethodNames) {
    if (!publicContractMethods.has(methodName)) {
      throw new Error(
        `api spec is stale: runtime/sdk/src/generated/api-spec.json still includes WorkbookVersion.${methodName}, but types/api/src/api/workbook/version-workbook.ts no longer declares it`,
      );
    }
  }

  for (const methodName of VERSION_SPEC_SUPPLEMENT_METHOD_NAMES) {
    if (!publicContractMethods.has(methodName)) {
      throw new Error(
        `WorkbookVersion.${methodName} facade spec supplement is not present in the public contract`,
      );
    }
  }

  for (const [methodName] of Object.entries(VERSION_METHOD_REQUIREMENTS)) {
    if (
      !Object.hasOwn(versionSpecMethods, methodName) &&
      !VERSION_SPEC_SUPPLEMENT_METHOD_NAMES.has(methodName)
    ) {
      throw new Error(`api spec is missing WorkbookVersion.${methodName}`);
    }
    const expected = versionMethodEntry(methodName);
    const entry = versionMatrix[methodName];
    if (!entry) {
      throw new Error(`workbook facade capability matrix is missing WorkbookVersion.${methodName}`);
    }
    if (entry.capability !== undefined) {
      throw new Error(
        `WorkbookVersion.${methodName} must use ordered capabilities, got scalar ${entry.capability}`,
      );
    }
    if (!Array.isArray(entry.capabilities)) {
      throw new Error(`WorkbookVersion.${methodName} must declare ordered capabilities`);
    }
    if (entry.capabilities.join('\0') !== expected.capabilities.join('\0')) {
      throw new Error(
        `WorkbookVersion.${methodName} must map to [${expected.capabilities.join(', ')}], got [${entry.capabilities.join(', ')}]`,
      );
    }
    if (
      JSON.stringify(entry.conditionalCapabilities ?? []) !==
      JSON.stringify(expected.conditionalCapabilities ?? [])
    ) {
      throw new Error(`WorkbookVersion.${methodName} has stale conditional capabilities`);
    }
    if (
      [
        ...entry.capabilities,
        ...(entry.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
      ].some((capability) => capability === 'workbook:read' || capability === 'workbook:write')
    ) {
      throw new Error(
        `WorkbookVersion.${methodName} must not map to generic workbook capabilities`,
      );
    }
  }

  for (const [methodName, entry] of Object.entries(versionMatrix)) {
    if (!Object.hasOwn(VERSION_METHOD_REQUIREMENTS, methodName)) {
      throw new Error(
        `WorkbookVersion.${methodName} was backfilled into the facade matrix without explicit version capability requirements`,
      );
    }
    if (
      !versionSpecMethodNames.has(methodName) &&
      !VERSION_SPEC_SUPPLEMENT_METHOD_NAMES.has(methodName)
    ) {
      throw new Error(
        `WorkbookVersion.${methodName} was backfilled into the facade matrix without generated spec coverage or an explicit supplement`,
      );
    }
    if (
      [
        ...(entry.capabilities ?? []),
        ...(entry.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
        ...(entry.capability ? [entry.capability] : []),
      ].some((capability) => capability === 'workbook:read' || capability === 'workbook:write')
    ) {
      throw new Error(
        `WorkbookVersion.${methodName} must not map to generic workbook capabilities`,
      );
    }
  }

  for (const [groupName, methodNames] of VERSION_METHOD_GROUPS) {
    for (const methodName of methodNames) {
      if (!Object.hasOwn(VERSION_METHOD_REQUIREMENTS, methodName)) {
        throw new Error(
          `WorkbookVersion.${methodName} ${groupName} method is missing explicit version capability requirements`,
        );
      }
      const entry = versionMatrix[methodName];
      if (!entry) {
        throw new Error(
          `workbook facade capability matrix is missing WorkbookVersion.${methodName} ${groupName} method`,
        );
      }
      if (entry.capability !== undefined) {
        throw new Error(
          `WorkbookVersion.${methodName} ${groupName} method must use capabilities or conditionalCapabilities, got scalar ${entry.capability}`,
        );
      }
      if (!Array.isArray(entry.capabilities)) {
        throw new Error(
          `WorkbookVersion.${methodName} ${groupName} method must declare ordered capabilities`,
        );
      }
    }
  }
}

assertVersionCapabilityMatrix();

function assertVersionSubApiInterfaces(subApiInterfaces) {
  const versionReviews = subApiInterfaces.WorkbookVersion?.reviews;
  if (versionReviews?.targetInterface !== 'WorkbookVersionReviewNamespace') {
    throw new Error('workbook facade sub-api interfaces must expose WorkbookVersion.reviews');
  }

  const versionReviewAdvanced = subApiInterfaces.WorkbookVersionReviewNamespace?.advanced;
  if (versionReviewAdvanced?.targetInterface !== 'WorkbookVersionReviewApi') {
    throw new Error(
      'workbook facade sub-api interfaces must expose WorkbookVersionReviewNamespace.advanced',
    );
  }

  const versionArtifacts = subApiInterfaces.WorkbookVersion?.artifacts;
  if (versionArtifacts?.targetInterface !== 'VersionMergeReviewArtifactNamespace') {
    throw new Error('workbook facade sub-api interfaces must expose WorkbookVersion.artifacts');
  }

  const versionArtifactAdvanced = subApiInterfaces.VersionMergeReviewArtifactNamespace?.advanced;
  if (versionArtifactAdvanced?.targetInterface !== 'VersionMergeReviewArtifactApi') {
    throw new Error(
      'workbook facade sub-api interfaces must expose VersionMergeReviewArtifactNamespace.advanced',
    );
  }

  const versionRefs = subApiInterfaces.WorkbookVersion?.refs;
  if (versionRefs?.targetInterface !== 'WorkbookVersionRefsNamespace') {
    throw new Error('workbook facade sub-api interfaces must expose WorkbookVersion.refs');
  }

  const versionProposals = subApiInterfaces.WorkbookVersion?.proposals;
  if (versionProposals?.targetInterface !== 'VersionProposalPorcelainApi') {
    throw new Error('workbook facade sub-api interfaces must expose WorkbookVersion.proposals');
  }

  const proposalAdvanced = subApiInterfaces.VersionProposalPorcelainApi?.advanced;
  if (proposalAdvanced?.targetInterface !== 'VersionProposalApi') {
    throw new Error(
      'workbook facade sub-api interfaces must expose VersionProposalPorcelainApi.advanced',
    );
  }
}

function assertVersionInterfaceRequirements(interfaceName, requirements) {
  const entries = matrix[interfaceName];
  if (!entries) {
    throw new Error(`workbook facade capability matrix is missing ${interfaceName}`);
  }
  const interfaceSpec = spec.interfaces[interfaceName]?.functions ?? {};
  for (const [methodName, requirement] of Object.entries(requirements)) {
    const specEntry = interfaceSpec[methodName];
    if (spec.interfaces[interfaceName] && (!specEntry || specEntry.targetInterface)) {
      throw new Error(`api spec is missing ${interfaceName}.${methodName}`);
    }
    const entry = entries[methodName];
    if (!entry) {
      throw new Error(
        `workbook facade capability matrix is missing ${interfaceName}.${methodName}`,
      );
    }
    const expected = capabilityEntry(requirement);
    if (entry.capability !== undefined) {
      throw new Error(
        `${interfaceName}.${methodName} must use ordered capabilities, got scalar ${entry.capability}`,
      );
    }
    if (!Array.isArray(entry.capabilities)) {
      throw new Error(`${interfaceName}.${methodName} must declare ordered capabilities`);
    }
    if (entry.capabilities.join('\0') !== expected.capabilities.join('\0')) {
      throw new Error(
        `${interfaceName}.${methodName} must map to [${expected.capabilities.join(', ')}], got [${entry.capabilities.join(', ')}]`,
      );
    }
  }
}

assertVersionInterfaceRequirements(
  'WorkbookVersionRefsNamespace',
  VERSION_REFS_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'WorkbookVersionReviewApi',
  VERSION_REVIEW_ADVANCED_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'VersionMergeReviewArtifactApi',
  VERSION_MERGE_ARTIFACT_ADVANCED_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'VersionProposalPorcelainApi',
  VERSION_PROPOSAL_PORCELAIN_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'VersionProposalApi',
  VERSION_PROPOSAL_ADVANCED_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'VersionProposalHandle',
  VERSION_PROPOSAL_HANDLE_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements(
  'VersionProposalWorkspaceHandle',
  VERSION_PROPOSAL_WORKSPACE_HANDLE_METHOD_REQUIREMENTS,
);
assertVersionInterfaceRequirements('VersionMergeReview', VERSION_MERGE_REVIEW_METHOD_REQUIREMENTS);

const subApiInterfaces = generatedSubApiInterfaces();
assertVersionSubApiInterfaces(subApiInterfaces);

const rawSource = `// Generated by scripts/generate-workbook-facade-matrix.mjs from runtime/sdk/src/generated/api-spec.json.
// Keep this artifact checked in. The boundary check fails if any public Workbook
// or child-handle method is missing an explicit decision.
import type { SpreadsheetCapability } from './public-types';

export type SpreadsheetFacadeDecision = 'allow' | 'deny';

export interface SpreadsheetFacadeMatrixEntry {
  readonly decision: SpreadsheetFacadeDecision;
  readonly capability?: SpreadsheetCapability;
  readonly capabilities?: readonly SpreadsheetCapability[];
  readonly returnsVersionResult?: boolean;
  readonly conditionalCapabilities?: readonly {
    readonly when: {
      readonly argumentIndex: number;
      readonly path: readonly string[];
      readonly presence: 'present';
    };
    readonly capabilities: readonly SpreadsheetCapability[];
  }[];
  readonly reason?: string;
  readonly returns?: readonly string[];
}

export type WorkbookSubApiInterfaces = Record<string, Record<string, unknown>>;

export const WORKBOOK_FACADE_GENERATED_FROM = 'runtime/sdk/src/generated/api-spec.json' as const;

export const WORKBOOK_SUB_API_INTERFACES: WorkbookSubApiInterfaces = ${formatValue(subApiInterfaces)};

export const WORKBOOK_FACADE_CAPABILITY_MATRIX = ${formatValue(matrix)} as const satisfies Record<string, Record<string, SpreadsheetFacadeMatrixEntry>>;
`;
const prettierConfig = (await resolvePrettierConfig(outPath)) ?? {};
const source = await formatWithPrettier(rawSource, { ...prettierConfig, filepath: outPath });

if (checkMode) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== source) {
    console.error(
      'workbook facade capability matrix is stale. Run `node runtime/spreadsheet-app/scripts/generate-workbook-facade-matrix.mjs`.',
    );
    process.exit(1);
  }
  console.log('workbook facade capability matrix is current');
} else {
  writeFileSync(outPath, source);
  console.log(`Wrote ${outPath}`);
}
