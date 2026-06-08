import type {
  ApiCompatibilityEntry,
  ApiCompatibilityIndex,
  ApiCompatibilityReference,
} from '../src/api-compatibility/types';

const SCHEMA_VERSION = '1';

export const API_COMPATIBILITY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mog.dev/schemas/api-compatibility.schema.json',
  title: 'Mog API Compatibility Registry',
  type: 'object',
  required: ['schemaVersion', 'entries', 'byId', 'byObservedPath', 'byCanonicalPath'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    entries: { type: 'array', items: { $ref: '#/$defs/entry' } },
    byId: { type: 'object', additionalProperties: { $ref: '#/$defs/entry' } },
    byObservedPath: {
      type: 'object',
      additionalProperties: { type: 'array', items: { $ref: '#/$defs/entry' } },
    },
    byCanonicalPath: {
      type: 'object',
      additionalProperties: { type: 'array', items: { $ref: '#/$defs/entry' } },
    },
  },
  $defs: {
    reference: {
      type: 'object',
      required: ['id', 'observedPath', 'canonicalPath', 'status', 'appliesTo'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        observedPath: { type: 'string', minLength: 1 },
        canonicalPath: { type: ['string', 'null'] },
        status: {
          enum: [
            'canonical',
            'contract_extension',
            'supported_alias',
            'input_alias',
            'deprecated_alias',
            'semantic_compatibility',
            'structured_diagnostic',
            'rejected',
          ],
        },
        appliesTo: { enum: ['method', 'property', 'argument', 'handle', 'result'] },
      },
    },
    entry: {
      type: 'object',
      required: [
        'id',
        'observedPath',
        'canonicalPath',
        'status',
        'appliesTo',
        'ownerTheme',
        'ownerPackage',
        'firstObservedVersion',
        'canonicalSince',
        'deprecatedSince',
        'removeAfter',
        'evidence',
        'behavior',
        'runtimeSurfaces',
        'surfaceDisposition',
        'verification',
      ],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        observedPath: { type: 'string', minLength: 1 },
        canonicalPath: { type: ['string', 'null'] },
        status: {
          enum: [
            'canonical',
            'contract_extension',
            'supported_alias',
            'input_alias',
            'deprecated_alias',
            'semantic_compatibility',
            'structured_diagnostic',
            'rejected',
          ],
        },
        appliesTo: { enum: ['method', 'property', 'argument', 'handle', 'result'] },
        ownerTheme: { type: 'string', minLength: 1 },
        ownerPackage: { type: 'string', minLength: 1 },
        firstObservedVersion: { type: ['string', 'null'] },
        canonicalSince: { type: ['string', 'null'] },
        deprecatedSince: { type: ['string', 'null'] },
        removeAfter: { type: ['string', 'null'] },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['source', 'reference'],
            additionalProperties: false,
            properties: {
              source: {
                enum: ['trace', 'eval', 'docs', 'training', 'prior_version', 'source'],
              },
              reference: { type: 'string', minLength: 1 },
            },
          },
        },
        behavior: { type: 'string', minLength: 1 },
        runtimeSurfaces: {
          type: 'array',
          items: {
            enum: [
              'typescript',
              'kernel',
              'executeCode-preflight',
              'api-describe',
              'agent-guidance',
              'docs',
              'python',
              'api-eval',
            ],
          },
        },
        surfaceDisposition: {
          type: 'object',
          additionalProperties: {
            enum: [
              'canonical',
              'contract_extension',
              'supported_alias',
              'input_alias',
              'deprecated_alias',
              'semantic_compatibility',
              'structured_diagnostic',
              'rejected',
            ],
          },
        },
        diagnostics: {
          type: 'object',
          required: ['code', 'message', 'replacements'],
          additionalProperties: false,
          properties: {
            code: { enum: ['MOG002_MOG_API_USAGE', 'MOG003_COMPATIBILITY_REJECTED'] },
            message: { type: 'string', minLength: 1 },
            replacements: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        verification: { type: 'array', items: { type: 'string', minLength: 1 } },
        notes: { type: 'string' },
      },
    },
  },
} as const;

export const API_COMPATIBILITY_REFERENCE_SCHEMA = API_COMPATIBILITY_SCHEMA.$defs.reference;

function toReference(entry: ApiCompatibilityEntry): ApiCompatibilityReference {
  return {
    id: entry.id,
    observedPath: entry.observedPath,
    canonicalPath: entry.canonicalPath,
    status: entry.status,
    appliesTo: entry.appliesTo,
  };
}

function stripCallSuffix(path: string): string {
  return path.trim().replace(/\(\s*\)$/, '');
}

function pathKeys(path: string): string[] {
  const stripped = stripCallSuffix(path);
  return [stripped, `${stripped}()`];
}

export function compatibilityReferencesForPath(
  index: ApiCompatibilityIndex,
  path: string,
): ApiCompatibilityReference[] {
  const matches = new Map<string, ApiCompatibilityEntry>();
  for (const key of pathKeys(path)) {
    for (const entry of index.byObservedPath[key] ?? []) matches.set(entry.id, entry);
    for (const entry of index.byCanonicalPath[key] ?? []) matches.set(entry.id, entry);
  }
  return [...matches.values()].map(toReference);
}

export function generateApiCompatibilityIndex(
  entries: readonly ApiCompatibilityEntry[],
): ApiCompatibilityIndex {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const byId: Record<string, ApiCompatibilityEntry> = {};
  const observed = new Map<string, ApiCompatibilityEntry[]>();
  const canonical = new Map<string, ApiCompatibilityEntry[]>();

  for (const entry of sorted) {
    byId[entry.id] = entry;
    for (const key of pathKeys(entry.observedPath)) {
      const list = observed.get(key) ?? [];
      list.push(entry);
      observed.set(key, list);
    }
    if (entry.canonicalPath) {
      for (const key of pathKeys(entry.canonicalPath)) {
        const list = canonical.get(key) ?? [];
        list.push(entry);
        canonical.set(key, list);
      }
    }
  }

  const byObservedPath: Record<string, readonly ApiCompatibilityEntry[]> = {};
  for (const [key, value] of [...observed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byObservedPath[key] = value;
  }
  const byCanonicalPath: Record<string, readonly ApiCompatibilityEntry[]> = {};
  for (const [key, value] of [...canonical.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byCanonicalPath[key] = value;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    entries: sorted,
    byId,
    byObservedPath,
    byCanonicalPath,
  };
}

function isGeneratedTargetPath(path: string): boolean {
  return /^(wb|ws)\.[A-Za-z0-9_.]+$/.test(stripCallSuffix(path));
}

function isExternalCompatibilityPath(path: string): boolean {
  return (
    path.startsWith('type:') ||
    path.startsWith('api.describe') ||
    path.includes('*') ||
    path.includes('(')
  );
}

export function assertApiCompatibilityIndex(
  index: ApiCompatibilityIndex,
  guidanceTargets: { byPath: Record<string, unknown> },
): void {
  if (index.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`api compatibility schemaVersion must be ${SCHEMA_VERSION}`);
  }

  const seen = new Set<string>();
  for (const entry of index.entries) {
    if (seen.has(entry.id)) throw new Error(`Duplicate compatibility entry id: ${entry.id}`);
    seen.add(entry.id);
    if (index.byId[entry.id] !== entry) {
      throw new Error(`Compatibility entry ${entry.id} missing from byId`);
    }
    if (!entry.evidence.length) throw new Error(`Compatibility entry ${entry.id} needs evidence`);
    if (!entry.ownerTheme || !entry.ownerPackage) {
      throw new Error(`Compatibility entry ${entry.id} needs owner metadata`);
    }
    if (!Object.prototype.hasOwnProperty.call(entry.surfaceDisposition, 'python')) {
      throw new Error(`Compatibility entry ${entry.id} must explicitly disposition python`);
    }

    if (
      ['supported_alias', 'deprecated_alias', 'input_alias'].includes(entry.status) &&
      !entry.canonicalPath
    ) {
      throw new Error(`Compatibility entry ${entry.id} must name a canonical path`);
    }
    if (entry.status === 'deprecated_alias' && (!entry.deprecatedSince || !entry.removeAfter)) {
      throw new Error(
        `Deprecated compatibility entry ${entry.id} must include deprecatedSince and removeAfter`,
      );
    }
    if (
      ['structured_diagnostic', 'rejected'].includes(entry.status) &&
      (!entry.diagnostics?.message || !entry.diagnostics.replacements.length)
    ) {
      throw new Error(`Diagnostic compatibility entry ${entry.id} must include diagnostics`);
    }

    if (entry.canonicalPath && isGeneratedTargetPath(entry.canonicalPath)) {
      const normalized = stripCallSuffix(entry.canonicalPath);
      if (!guidanceTargets.byPath[normalized]) {
        throw new Error(
          `Compatibility entry ${entry.id} canonical path ${entry.canonicalPath} is not a generated guidance target`,
        );
      }
    }

    if (
      isGeneratedTargetPath(entry.observedPath) &&
      ['supported_alias', 'deprecated_alias', 'contract_extension'].includes(entry.status)
    ) {
      const normalized = stripCallSuffix(entry.observedPath);
      if (!guidanceTargets.byPath[normalized] && !isExternalCompatibilityPath(entry.observedPath)) {
        throw new Error(
          `Compatibility entry ${entry.id} observed path ${entry.observedPath} is not a generated guidance target`,
        );
      }
    }
  }
}
