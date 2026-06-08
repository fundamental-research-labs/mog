import rawApiSpec from './generated/api-spec.json';
import { apiCompatibility, type ApiCompatibilityIndex } from './api-compatibility/index';
import { apiGuidance, type ApiGuidanceApi } from './agent-guidance/index';
import type { ApiCompatibilityReference } from './api-compatibility/types';

// ─── Return Types ────────────────────────────────────────────────────────────

export interface ApiSpecFunctionEntry {
  signature: string;
  docstring: string;
  usedTypes: string[];
  compatibility?: ApiCompatibilityReference[];
  targetInterface?: string;
}

export interface ApiSpecInterfaceEntry {
  docstring: string;
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

// ─── Index built at module load ──────────────────────────────────────────────

// Path map: 'wb.sheets' → 'WorkbookSheets', 'ws.charts' → 'WorksheetCharts'
const pathMap: Record<string, string> = {};

// Sub-API accessor names per root: { wb: Set('sheets','history'), ws: Set('charts','formats') }
const subApiAccessors: Record<string, Set<string>> = { wb: new Set(), ws: new Set() };

function getSubApisForRoot(root: 'wb' | 'ws'): Record<string, ApiSpecFunctionEntry> {
  return root === 'wb' ? spec.subApis.workbook : spec.subApis.worksheet;
}

for (const root of ['wb', 'ws'] as const) {
  for (const [accessor, entry] of Object.entries(getSubApisForRoot(root))) {
    if (!entry.targetInterface) continue;
    pathMap[`${root}.${accessor}`] = entry.targetInterface;
    subApiAccessors[root].add(accessor);
  }
}

// Root interface names
const rootInterfaces: Record<string, string> = {
  wb: 'Workbook',
  ws: 'Worksheet',
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
    };
  }

  // type:X → direct type lookup
  if (path.startsWith('type:')) {
    const typeName = path.slice(5);
    return resolveType(typeName);
  }

  const parts = path.split('.');
  const root = parts[0]; // 'wb' or 'ws'

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

  const second = parts[1];

  if (parts.length === 2) {
    // Could be a sub-API: describe('ws.charts')
    const subIfaceName = pathMap[`${root}.${second}`];
    if (subIfaceName) {
      return {
        name: subIfaceName,
        path: `${root}.${second}`,
        docstring:
          (
            spec.interfaces[subIfaceName as keyof typeof spec.interfaces] as
              | { docstring: string }
              | undefined
          )?.docstring ?? '',
        methods: buildMethodSummaries(subIfaceName),
      };
    }

    // Otherwise a direct method on the root interface: describe('ws.setCell')
    return resolveMethod(rootIfaceName, second, `${root}.${second}`);
  }

  if (parts.length === 3) {
    // describe('ws.charts.add') → method on a sub-API
    const subIfaceName = pathMap[`${root}.${second}`];
    if (!subIfaceName) return null;
    const methodName = parts[2];
    return resolveMethod(subIfaceName, methodName, path);
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
// Navigate the API as an object tree instead of passing string paths:
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

function buildSubApiNode(ifaceName: string, root: string, accessor: string): SubApiNode {
  const iface = spec.interfaces[ifaceName as keyof typeof spec.interfaces] as
    | { docstring: string; functions: Record<string, unknown> }
    | undefined;

  const fullPath = `${root}.${accessor}`;
  const node: Record<string, unknown> = {
    name: ifaceName,
    path: fullPath,
    docstring: iface?.docstring ?? '',
    methods: buildMethodSummaries(ifaceName),
  };

  // Add lazy getters for each method on this sub-API
  if (iface) {
    for (const methodName of Object.keys(iface.functions)) {
      if (RESERVED_PROPS.has(methodName)) continue;
      Object.defineProperty(node, methodName, {
        get() {
          return cachedResolveMethod(ifaceName, methodName, `${fullPath}.${methodName}`);
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
        if (!cached) cached = buildSubApiNode(subIfaceName as string, root, accessor);
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
  guidance: ApiGuidanceApi;
  compatibility: ApiCompatibilityIndex;
  wb: RootNode;
  ws: RootNode;
  types: TypesNode;
} = {
  describe,
  guidance: apiGuidance,
  compatibility: apiCompatibility,
  wb: buildRootNode('wb'),
  ws: buildRootNode('ws'),
  types: buildTypesNode(),
};
