import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(packageRoot, '../..');
const specPath = resolve(repoRoot, 'runtime/sdk/src/generated/api-spec.json');
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
const VERSION_CAPABILITY_BY_METHOD = {
  getStatus: 'version:read',
  getSurfaceStatus: null,
  getHead: 'version:read',
  listCommits: 'version:read',
  readRef: 'version:read',
  getRef: 'version:read',
  listRefs: 'version:read',
  promotePendingRemote: 'version:provenance',
  diff: 'version:diff',
  commit: 'version:commit',
  checkout: 'version:checkout',
  merge: 'version:mergePreview',
  applyMerge: 'version:mergeApply',
  saveMergeResolutions: 'version:mergeApply',
  getMergeConflictDetail: 'version:mergePreview',
  putMergeResolutionPayload: 'version:mergeApply',
  createBranch: 'version:branch',
  fastForwardBranch: 'version:branch',
  updateBranch: 'version:branch',
  deleteBranch: 'version:branch',
  deleteRef: 'version:branch',
};
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
  if (interfaceName === 'WorkbookVersion') {
    if (!Object.hasOwn(VERSION_CAPABILITY_BY_METHOD, methodName)) {
      throw new Error(`WorkbookVersion.${methodName} is missing an explicit version capability`);
    }
    const capability = VERSION_CAPABILITY_BY_METHOD[methodName];
    if (capability === null) return { decision: 'allow' };
    return { decision: 'allow', capability };
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
  for (const interfaceName of Object.keys(spec.interfaces).sort()) {
    if (interfaceName === 'Workbook') continue;
    const pattern = new RegExp(`\\b${interfaceName}\\b`);
    if (pattern.test(signature)) result.push(interfaceName);
  }
  return result;
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
    entries[methodName] = {
      ...classify(interfaceName, methodName),
      ...(returnedInterfaces(methodSpec.signature).length > 0
        ? { returns: returnedInterfaces(methodSpec.signature) }
        : {}),
    };
  }
  matrix[interfaceName] = entries;
}

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

  for (const [methodName, capability] of Object.entries(VERSION_CAPABILITY_BY_METHOD)) {
    const entry = versionMatrix[methodName];
    if (!entry) {
      throw new Error(`workbook facade capability matrix is missing WorkbookVersion.${methodName}`);
    }
    if (capability === null) {
      if (entry.capability !== undefined) {
        throw new Error(
          `WorkbookVersion.${methodName} must be capability-free, got ${entry.capability}`,
        );
      }
      continue;
    }
    if (entry.capability !== capability) {
      throw new Error(
        `WorkbookVersion.${methodName} must map to ${capability}, got ${entry.capability}`,
      );
    }
    if (entry.capability === 'workbook:read' || entry.capability === 'workbook:write') {
      throw new Error(`WorkbookVersion.${methodName} must not map to a generic workbook capability`);
    }
  }
}

assertVersionCapabilityMatrix();

const source = `// Generated by scripts/generate-workbook-facade-matrix.mjs from runtime/sdk/src/generated/api-spec.json.
// Keep this artifact checked in. The boundary check fails if any public Workbook
// or child-handle method is missing an explicit decision.
import type { SpreadsheetCapability } from './public-types';

export type SpreadsheetFacadeDecision = 'allow' | 'deny';

export interface SpreadsheetFacadeMatrixEntry {
  readonly decision: SpreadsheetFacadeDecision;
  readonly capability?: SpreadsheetCapability;
  readonly reason?: string;
  readonly returns?: readonly string[];
}

export type WorkbookSubApiInterfaces = Record<string, Record<string, unknown>>;

export const WORKBOOK_FACADE_GENERATED_FROM = 'runtime/sdk/src/generated/api-spec.json' as const;

export const WORKBOOK_SUB_API_INTERFACES: WorkbookSubApiInterfaces = ${formatValue(spec.subApis)};

export const WORKBOOK_FACADE_CAPABILITY_MATRIX = ${formatValue(matrix)} as const satisfies Record<string, Record<string, SpreadsheetFacadeMatrixEntry>>;
`;

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
