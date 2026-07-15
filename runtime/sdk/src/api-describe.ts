import rawApiSpec from './generated/api-spec.json';
import { apiCompatibility, type ApiCompatibilityIndex } from './api-compatibility/index';
import { apiGuidance, type ApiGuidanceApi } from './agent-guidance/index';
import { Utils, a1, type PublicA1Utils, type PublicUtils } from './public-kernel-facade';
import type { ApiCompatibilityReference } from './api-compatibility/types';

// ─── Return Types ────────────────────────────────────────────────────────────

export interface ApiSpecFunctionEntry {
  signature: string;
  docstring: string;
  usedTypes: string[];
  kind?: 'method' | 'property' | 'subApiAccessor';
  canonicalPath?: string;
  compatibility?: ApiCompatibilityReference[];
  targetInterface?: string;
}

export interface ApiSpecInterfaceEntry {
  docstring: string;
  members: Record<string, ApiSpecFunctionEntry>;
  functions: Record<string, ApiSpecFunctionEntry>;
}

export interface ApiSpecTypeEntry {
  name: string;
  definition?: string;
  isEnum?: boolean;
  values?: Record<string, string>;
  docstring?: string;
}

export interface ApiSpec {
  compatibility?: ApiCompatibilityIndex;
  subApis: {
    workbook: Record<string, ApiSpecFunctionEntry>;
    worksheet: Record<string, ApiSpecFunctionEntry>;
  };
  interfaces: Record<string, ApiSpecInterfaceEntry>;
  types: Record<string, ApiSpecTypeEntry>;
  formatPresets?: Record<
    string,
    Record<string, { code: string; example: string; description?: string }>
  >;
  defaultFormats?: Record<string, string>;
  generated?: string;
}

export const apiSpec: ApiSpec = rawApiSpec as unknown as ApiSpec;
const spec = apiSpec;

export interface OverviewResult {
  workbook: { methods: string[]; subApis: string[] };
  worksheet: { methods: string[]; subApis: string[] };
  utilities: { namespaces: string[]; methods: string[] };
}

export interface MethodSummary {
  name: string;
  signature: string;
  docstring: string;
  compatibility: ApiCompatibilityReference[];
}

export interface InterfaceResult {
  name: string;
  path: string;
  docstring: string;
  methods: MethodSummary[];
}

export interface MethodResult {
  name: string;
  path: string;
  signature: string;
  docstring: string;
  compatibility: ApiCompatibilityReference[];
  types: Record<string, TypeResult>;
}

export interface TypeResult {
  name: string;
  definition?: string;
  isEnum?: boolean;
  values?: Record<string, string>;
  docstring?: string;
}

export type DescribeResult = OverviewResult | InterfaceResult | MethodResult | TypeResult | null;

export type ApiSearchResultKind = 'method' | 'property' | 'subApi' | 'type' | 'utility';

export interface ApiSearchOptions {
  /** Maximum results to return. Defaults to 20. */
  limit?: number;
  /** Restrict results to one or more API surface kinds. */
  kinds?: readonly ApiSearchResultKind[];
}

export interface ApiSearchResult {
  /** Exact path accepted by api.describe(). */
  path: string;
  name: string;
  kind: ApiSearchResultKind;
  signature?: string;
  docstring: string;
}

// ─── Index built at module load ──────────────────────────────────────────────

// Sub-API accessor names per root: { wb: Set('sheets','history'), ws: Set('charts','formats') }
const subApiAccessors: Record<string, Set<string>> = { wb: new Set(), ws: new Set() };

function getSubApisForRoot(root: 'wb' | 'ws'): Record<string, ApiSpecFunctionEntry> {
  return root === 'wb' ? spec.subApis.workbook : spec.subApis.worksheet;
}

for (const root of ['wb', 'ws'] as const) {
  for (const [accessor, entry] of Object.entries(getSubApisForRoot(root))) {
    if (!entry.targetInterface) continue;
    subApiAccessors[root].add(accessor);
  }
}

// Root interface names
const rootInterfaces: Record<string, string> = {
  wb: 'Workbook',
  ws: 'Worksheet',
};

const A1_UTILITY_METHODS: Record<string, ApiSpecFunctionEntry> = {
  address: {
    signature: 'address(row: number, col: number): string',
    docstring: 'Format zero-based Mog row/column coordinates as an A1 cell address.',
    usedTypes: [],
  },
  range: {
    signature: 'range(row1: number, col1: number, row2: number, col2: number): string',
    docstring: 'Format two zero-based Mog coordinate pairs as an A1 range address.',
    usedTypes: [],
  },
  column: {
    signature: 'column(index: number): string',
    docstring: 'Format a zero-based Mog column index as a spreadsheet column name.',
    usedTypes: [],
  },
  columnIndex: {
    signature: 'columnIndex(name: string): number',
    docstring: 'Parse a spreadsheet column name into a zero-based Mog column index.',
    usedTypes: [],
  },
  offset: {
    signature: 'offset(address: string, dr: number, dc: number): string',
    docstring: 'Offset an A1 cell address by row and column deltas.',
    usedTypes: [],
  },
  parse: {
    signature: 'parse(address: string): { row: number; col: number; sheetName?: string } | null',
    docstring: 'Parse an A1 cell address into zero-based Mog row/column coordinates.',
    usedTypes: [],
  },
  rangeAddress: {
    signature: 'rangeAddress(row1: number, col1: number, row2: number, col2: number): string',
    docstring: 'Descriptive alias for a1.range().',
    usedTypes: [],
  },
  columnName: {
    signature: 'columnName(index: number): string',
    docstring: 'Descriptive alias for a1.column().',
    usedTypes: [],
  },
  parseAddress: {
    signature:
      'parseAddress(address: string): { row: number; col: number; sheetName?: string } | null',
    docstring: 'Descriptive alias for a1.parse().',
    usedTypes: [],
  },
};

/** Built-in type names to skip when extracting type references from definitions. */
const BUILTIN_TYPE_NAMES = new Set([
  'Promise',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Array',
  'Record',
  'Map',
  'Set',
  'Uint8Array',
  'ArrayBuffer',
  'Function',
  'Object',
  'Date',
  'RegExp',
  'Error',
  'Symbol',
  'string',
  'number',
  'boolean',
  'void',
  'null',
  'undefined',
  'any',
  'never',
  'unknown',
]);

/** Extract PascalCase type references from a type definition string. */
function extractTypeRefs(definition: string): string[] {
  const refs: string[] = [];
  for (const [, name] of definition.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
    if (!BUILTIN_TYPE_NAMES.has(name)) {
      refs.push(name);
    }
  }
  return refs;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMethodsExcludingAccessors(ifaceName: string, root: string): string[] {
  const iface = spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | { functions: Record<string, unknown> }
    | undefined;
  if (!iface) return [];
  const accessors = subApiAccessors[root] ?? new Set();
  return Object.keys(iface.functions).filter((m) => !accessors.has(m));
}

function buildMethodSummaries(ifaceName: string, excludeAccessors?: Set<string>): MethodSummary[] {
  const iface = spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | { functions: Record<string, ApiSpecFunctionEntry> }
    | undefined;
  if (!iface) return [];
  const exclude = excludeAccessors ?? new Set<string>();
  return Object.entries(iface.functions)
    .filter(([name]) => !exclude.has(name))
    .map(([name, fn]) => ({
      name,
      signature: fn.signature,
      docstring: fn.docstring,
      compatibility: fn.compatibility ?? [],
    }));
}

function getInterfaceEntry(ifaceName: string):
  | {
      docstring: string;
      members: Record<string, ApiSpecFunctionEntry>;
      functions: Record<string, ApiSpecFunctionEntry>;
    }
  | undefined {
  return spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | {
        docstring: string;
        members: Record<string, ApiSpecFunctionEntry>;
        functions: Record<string, ApiSpecFunctionEntry>;
      }
    | undefined;
}

function getInterfaceMember(ifaceName: string, memberName: string): ApiSpecFunctionEntry | null {
  const iface = getInterfaceEntry(ifaceName);
  return iface?.members[memberName] ?? iface?.functions[memberName] ?? null;
}

function nestedAccessorsForInterface(ifaceName: string): Set<string> {
  const iface = getInterfaceEntry(ifaceName);
  if (!iface) return new Set();
  return new Set(
    Object.entries(iface.members)
      .filter(([, entry]) => Boolean(entry.targetInterface))
      .map(([name]) => name),
  );
}

function buildInterfaceResult(ifaceName: string, fullPath: string): InterfaceResult {
  const nestedAccessors = nestedAccessorsForInterface(ifaceName);
  return {
    name: ifaceName,
    path: fullPath,
    docstring: getInterfaceEntry(ifaceName)?.docstring ?? '',
    methods: buildMethodSummaries(ifaceName, nestedAccessors),
  };
}

function compatibilityReferencesForPath(path: string): ApiCompatibilityReference[] {
  return (apiCompatibility.byCanonicalPath[path] ?? []).map((entry) => ({
    id: entry.id,
    observedPath: entry.observedPath,
    canonicalPath: entry.canonicalPath,
    status: entry.status,
    appliesTo: entry.appliesTo,
  }));
}

function buildA1MethodSummaries(): MethodSummary[] {
  return Object.entries(A1_UTILITY_METHODS).map(([name, fn]) => ({
    name,
    signature: fn.signature,
    docstring: fn.docstring,
    compatibility: compatibilityReferencesForPath(`a1.${name}`),
  }));
}

function describeA1(parts: string[]): InterfaceResult | MethodResult | null {
  if (parts.length === 1) {
    return {
      name: 'A1AddressHelpers',
      path: 'a1',
      docstring: 'Stateless helpers for generated A1 addresses and column names.',
      methods: buildA1MethodSummaries(),
    };
  }

  if (parts.length !== 2) return null;

  const methodName = parts[1];
  const fn = A1_UTILITY_METHODS[methodName];
  if (!fn) return null;

  const fullPath = `a1.${methodName}`;
  return {
    name: methodName,
    path: fullPath,
    signature: fn.signature,
    docstring: fn.docstring,
    compatibility: compatibilityReferencesForPath(fullPath),
    types: {},
  };
}

function resolveType(name: string): TypeResult | null {
  // Check spec.types first
  const t = spec.types[name as keyof typeof spec.types] as
    | {
        name: string;
        definition?: string;
        isEnum?: boolean;
        values?: Record<string, string>;
        docstring?: string;
      }
    | undefined;
  if (t) {
    const result: TypeResult = { name: t.name };
    if (t.definition !== undefined) result.definition = t.definition;
    if (t.isEnum !== undefined) result.isEnum = t.isEnum;
    if (t.values !== undefined) result.values = t.values;
    if (t.docstring !== undefined) result.docstring = t.docstring;
    return result;
  }

  // Check spec.interfaces (data interfaces like AddChartOptions)
  const iface = spec.interfaces[name as keyof typeof spec.interfaces] as
    | { docstring: string; functions: Record<string, { signature: string }> }
    | undefined;
  if (iface) {
    const fields = Object.entries(iface.functions)
      .map(([k, v]) => `  ${k}: ${v.signature}`)
      .join(';\n');
    return {
      name,
      definition: `{ ${fields ? '\n' + fields + ';\n' : ''}}`,
      docstring: iface.docstring,
    };
  }

  return null;
}

// ─── describe() ──────────────────────────────────────────────────────────────

function describe(): OverviewResult;
function describe(path: string): DescribeResult;
function describe(path?: string): DescribeResult {
  // No args → overview
  if (path === undefined || path === '') {
    return {
      workbook: {
        methods: getMethodsExcludingAccessors('Workbook', 'wb'),
        subApis: Object.keys(getSubApisForRoot('wb')),
      },
      worksheet: {
        methods: getMethodsExcludingAccessors('Worksheet', 'ws'),
        subApis: Object.keys(getSubApisForRoot('ws')),
      },
      utilities: {
        namespaces: ['a1'],
        methods: Object.keys(A1_UTILITY_METHODS).map((name) => `a1.${name}`),
      },
    };
  }

  // type:X → direct type lookup
  if (path.startsWith('type:')) {
    const typeName = path.slice(5);
    return resolveType(typeName);
  }

  const parts = path.split('.');
  const root = parts[0]; // 'wb', 'ws', or utility root

  if (root === 'a1') return describeA1(parts);
  if (root !== 'wb' && root !== 'ws') return null;

  const rootIfaceName = rootInterfaces[root];
  if (!rootIfaceName) return null;

  // describe('wb') or describe('ws') → root interface overview
  if (parts.length === 1) {
    return {
      name: rootIfaceName,
      path: root,
      docstring:
        (
          spec.interfaces[rootIfaceName as keyof typeof spec.interfaces] as
            | { docstring: string }
            | undefined
        )?.docstring ?? '',
      methods: buildMethodSummaries(rootIfaceName, subApiAccessors[root]),
    };
  }

  let currentIfaceName = rootIfaceName;
  let currentPath = root;

  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    const fullPath = `${currentPath}.${part}`;
    const entry = getInterfaceMember(currentIfaceName, part);
    if (!entry) return null;

    const isLast = index === parts.length - 1;
    if (isLast) {
      if (entry.targetInterface) {
        return buildInterfaceResult(entry.targetInterface, fullPath);
      }
      return resolveMethod(currentIfaceName, part, fullPath);
    }

    if (!entry.targetInterface) return null;
    currentIfaceName = entry.targetInterface;
    currentPath = fullPath;
  }

  return null;
}

function resolveMethod(
  ifaceName: string,
  methodName: string,
  fullPath: string,
): MethodResult | null {
  const iface = spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | {
        functions: Record<string, ApiSpecFunctionEntry>;
      }
    | undefined;
  if (!iface) return null;

  const fn = iface.functions[methodName as keyof typeof iface.functions];
  if (!fn) return null;

  // Resolve usedTypes transitively — include types referenced within definitions
  const types: Record<string, TypeResult> = {};
  const queue = [...fn.usedTypes];
  const seen = new Set<string>(queue);

  while (queue.length > 0) {
    const typeName = queue.shift()!;
    const resolved = resolveType(typeName);
    if (!resolved) continue;
    types[typeName] = resolved;

    // Extract type references from the resolved definition
    if (resolved.definition) {
      for (const ref of extractTypeRefs(resolved.definition)) {
        if (!seen.has(ref)) {
          seen.add(ref);
          queue.push(ref);
        }
      }
    }
  }

  return {
    name: methodName,
    path: fullPath,
    signature: fn.signature,
    docstring: fn.docstring,
    compatibility: fn.compatibility ?? [],
    types,
  };
}

// ─── Object Tree API ────────────────────────────────────────────────────────
//
// Search the installed API before constructing the object-tree facade below.
interface SearchIndexEntry extends ApiSearchResult {
  normalizedPath: string;
  normalizedName: string;
  normalizedSignature: string;
  normalizedDocstring: string;
  haystack: string;
}

interface SearchIndexSeed extends ApiSearchResult {
  searchText?: string;
}

let searchIndex: SearchIndexEntry[] | null = null;

function normalizeSearchText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function searchResultKind(entry: ApiSpecFunctionEntry): ApiSearchResultKind {
  if (entry.targetInterface || entry.kind === 'subApiAccessor') return 'subApi';
  if (entry.kind === 'property') return 'property';
  return 'method';
}

/**
 * Collect the effective definition of a public type, including definitions it
 * composes through aliases, intersections, mapped types, and nested members.
 * Generated definitions intentionally preserve those references instead of
 * flattening them, so indexing only the root text would hide inherited fields.
 */
function collectTypeSearchText(typeName: string): string {
  const definitions: string[] = [];
  const queue = [typeName];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const entry = spec.types[current];
    if (!entry?.definition) continue;
    definitions.push(entry.definition);

    for (const ref of extractTypeRefs(entry.definition)) {
      if (!seen.has(ref) && spec.types[ref]) queue.push(ref);
    }
  }

  return definitions.join('\n');
}

function buildSearchIndex(): SearchIndexEntry[] {
  const results = new Map<string, SearchIndexSeed>();

  for (const iface of Object.values(spec.interfaces)) {
    for (const [name, entry] of Object.entries(iface.members)) {
      const path = entry.canonicalPath;
      if (!path || results.has(path)) continue;
      results.set(path, {
        path,
        name,
        kind: searchResultKind(entry),
        signature: entry.signature,
        docstring: entry.docstring,
      });
    }
  }

  for (const [name, entry] of Object.entries(A1_UTILITY_METHODS)) {
    const path = `a1.${name}`;
    results.set(path, {
      path,
      name,
      kind: 'utility',
      signature: entry.signature,
      docstring: entry.docstring,
    });
  }

  for (const [name, entry] of Object.entries(spec.types)) {
    const path = `type:${name}`;
    results.set(path, {
      path,
      name,
      kind: 'type',
      docstring: entry.docstring ?? '',
      searchText: collectTypeSearchText(name),
    });
  }

  return [...results.values()].map((result) => {
    const { searchText = '', ...publicResult } = result;
    const normalizedPath = normalizeSearchText(result.path);
    const normalizedName = normalizeSearchText(result.name);
    const normalizedSignature = normalizeSearchText(result.signature ?? '');
    const normalizedDocstring = normalizeSearchText(result.docstring);
    return {
      ...publicResult,
      normalizedPath,
      normalizedName,
      normalizedSignature,
      normalizedDocstring,
      haystack: [
        normalizedPath,
        normalizedName,
        normalizedSignature,
        normalizedDocstring,
        normalizeSearchText(searchText),
      ].join(' '),
    };
  });
}

function searchScore(
  entry: SearchIndexEntry,
  normalizedQuery: string,
  terms: readonly string[],
): number {
  let score = 0;
  if (entry.normalizedPath === normalizedQuery) score += 1_000;
  if (entry.normalizedName === normalizedQuery) score += 800;
  if (entry.normalizedPath.includes(normalizedQuery)) score += 300;
  if (entry.normalizedName.includes(normalizedQuery)) score += 200;
  for (const term of terms) {
    if (entry.normalizedPath.includes(term)) score += 30;
    if (entry.normalizedName.includes(term)) score += 20;
    if (entry.normalizedSignature.includes(term)) score += 10;
    if (entry.normalizedDocstring.includes(term)) score += 5;
  }
  return score;
}

/**
 * Search the API bundled with the installed SDK version.
 *
 * Terms are case-insensitive, camelCase-aware, and ANDed. Results contain exact
 * paths that can be passed to api.describe() for complete signatures and types.
 */
function search(query: string, options: ApiSearchOptions = {}): ApiSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/);
  const allowedKinds = options.kinds ? new Set(options.kinds) : null;
  const requestedLimit = options.limit ?? 20;
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : 20;
  if (limit === 0) return [];

  searchIndex ??= buildSearchIndex();
  return searchIndex
    .filter(
      (entry) =>
        (!allowedKinds || allowedKinds.has(entry.kind)) &&
        terms.every((term) => entry.haystack.includes(term)),
    )
    .map((entry) => ({ entry, score: searchScore(entry, normalizedQuery, terms) }))
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, limit)
    .map(({ entry }) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      ...(entry.signature ? { signature: entry.signature } : {}),
      docstring: entry.docstring,
    }));
}

// Object tree navigation:
//
//   api.ws.charts                → sub-API node (name, docstring, methods)
//   api.ws.charts.add            → method node  (signature, docstring, types)
//   api.ws.charts.add.types      → transitively resolved types
//   api.ws.setCell               → direct method on root interface
//   api.types.ChartConfig        → type node    (definition, docstring)
//   api.types.AxisConfig         → type node
//
// Every level is a plain object — JSON.stringify-safe, inspectable, navigable.

export interface MethodNode {
  readonly name: string;
  readonly path: string;
  readonly signature: string;
  readonly docstring: string;
  readonly compatibility: ApiCompatibilityReference[];
  readonly types: Record<string, TypeResult>;
}

export interface SubApiNode {
  readonly name: string;
  readonly path: string;
  readonly docstring: string;
  readonly methods: MethodSummary[];
  readonly [methodName: string]: MethodNode | unknown;
}

export interface RootNode {
  readonly name: string;
  readonly methods: MethodSummary[];
  readonly subApis: string[];
  readonly [key: string]: SubApiNode | MethodNode | unknown;
}

export interface TypesNode {
  readonly [typeName: string]: TypeResult;
}

// Memoize resolveMethod results — tree access may hit the same method repeatedly
const methodCache = new Map<string, MethodResult | null>();

function cachedResolveMethod(
  ifaceName: string,
  methodName: string,
  fullPath: string,
): MethodResult | null {
  if (methodCache.has(fullPath)) return methodCache.get(fullPath)!;
  const result = resolveMethod(ifaceName, methodName, fullPath);
  methodCache.set(fullPath, result);
  return result;
}

/** Reserved property names on node objects — method accessors must not shadow these. */
const RESERVED_PROPS = new Set([
  'name',
  'path',
  'docstring',
  'methods',
  'subApis',
  'types',
  'signature',
]);

function buildSubApiNode(ifaceName: string, fullPath: string): SubApiNode {
  const iface = getInterfaceEntry(ifaceName);
  const nestedAccessors = nestedAccessorsForInterface(ifaceName);
  const node: Record<string, unknown> = {
    name: ifaceName,
    path: fullPath,
    docstring: iface?.docstring ?? '',
    methods: buildMethodSummaries(ifaceName, nestedAccessors),
  };

  // Add lazy getters for each member on this sub-API.
  if (iface) {
    for (const [methodName, entry] of Object.entries(iface.members)) {
      if (RESERVED_PROPS.has(methodName)) continue;
      const memberPath = `${fullPath}.${methodName}`;
      if (entry.targetInterface) {
        let cached: SubApiNode | undefined;
        Object.defineProperty(node, methodName, {
          get() {
            if (!cached) cached = buildSubApiNode(entry.targetInterface as string, memberPath);
            return cached;
          },
          enumerable: true,
          configurable: true,
        });
        continue;
      }
      Object.defineProperty(node, methodName, {
        get() {
          return cachedResolveMethod(ifaceName, methodName, memberPath);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  return node as SubApiNode;
}

function buildRootNode(root: 'wb' | 'ws'): RootNode {
  const ifaceName = rootInterfaces[root]!;
  const accessors = subApiAccessors[root] ?? new Set<string>();

  const node: Record<string, unknown> = {
    name: ifaceName,
    methods: buildMethodSummaries(ifaceName, accessors),
    subApis: [...accessors],
  };

  // Add sub-API accessors (e.g., api.ws.charts → SubApiNode)
  const subs = getSubApisForRoot(root);
  for (const [accessor, entry] of Object.entries(subs)) {
    const subIfaceName = entry.targetInterface;
    if (!subIfaceName) continue;
    if (RESERVED_PROPS.has(accessor)) continue;
    let cached: SubApiNode | undefined;
    Object.defineProperty(node, accessor, {
      get() {
        if (!cached) cached = buildSubApiNode(subIfaceName as string, `${root}.${accessor}`);
        return cached;
      },
      enumerable: true,
      configurable: true,
    });
  }

  // Add direct method accessors (e.g., api.ws.setCell → MethodNode)
  const iface = spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | { functions: Record<string, unknown> }
    | undefined;
  if (iface) {
    for (const methodName of Object.keys(iface.functions)) {
      if (accessors.has(methodName) || RESERVED_PROPS.has(methodName) || methodName in node)
        continue;
      Object.defineProperty(node, methodName, {
        get() {
          return cachedResolveMethod(ifaceName, methodName, `${root}.${methodName}`);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  return node as RootNode;
}

function buildTypesNode(): TypesNode {
  const node: Record<string, TypeResult> = {};
  for (const name of Object.keys(spec.types)) {
    let cached: TypeResult | null | undefined;
    Object.defineProperty(node, name, {
      get() {
        if (cached === undefined) cached = resolveType(name);
        return cached;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return node as TypesNode;
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const api: {
  describe: {
    (): OverviewResult;
    (path: string): DescribeResult;
  };
  search: (query: string, options?: ApiSearchOptions) => ApiSearchResult[];
  guidance: ApiGuidanceApi;
  compatibility: ApiCompatibilityIndex;
  a1: PublicA1Utils;
  utils: PublicUtils;
  wb: RootNode;
  ws: RootNode;
  types: TypesNode;
} = {
  describe,
  search,
  guidance: apiGuidance,
  compatibility: apiCompatibility,
  a1,
  utils: Utils,
  wb: buildRootNode('wb'),
  ws: buildRootNode('ws'),
  types: buildTypesNode(),
};
