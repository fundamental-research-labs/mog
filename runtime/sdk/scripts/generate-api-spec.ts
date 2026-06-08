/**
 * SDK API Spec Generator
 *
 * Auto-discovers sub-API mappings, interfaces, and referenced types from
 * `contracts/src/api/` TypeScript contract interfaces.
 *
 * Unlike the existing generators, this does NOT use hand-maintained lists
 * for sub-APIs, interface files, or external types. It discovers everything
 * by scanning readonly property signatures on Workbook/Worksheet that
 * reference other interfaces, then transitively collects all PascalCase
 * type references from method signatures.
 *
 * Run:  npx tsx runtime/sdk/scripts/generate-api-spec.ts
 *
 * Output:
 *   runtime/sdk/src/generated/api-spec.json
 *   runtime/sdk/src/generated/api-spec.schema.json
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Project, type SourceFile as MorphSourceFile } from 'ts-morph';
import {
  FORMAT_PRESETS,
  DEFAULT_FORMAT_BY_TYPE,
} from '@mog-sdk/contracts/number-formats/constants';
import { apiGuidanceCatalog, documentedRootGuidancePaths } from '../src/agent-guidance/catalog';
import { apiCompatibilityRegistry } from '../src/api-compatibility/registry';
import {
  API_COMPATIBILITY_REFERENCE_SCHEMA,
  API_COMPATIBILITY_SCHEMA,
  assertApiCompatibilityIndex,
  compatibilityReferencesForPath,
  generateApiCompatibilityIndex,
} from './api-compatibility-generation';
import type {
  ApiCompatibilityIndex,
  ApiCompatibilityReference,
} from '../src/api-compatibility/types';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const CONTRACTS_API_DIR = path.resolve(REPO_ROOT, 'contracts/src/api');
const CONTRACTS_SRC_DIR = path.resolve(REPO_ROOT, 'contracts/src');
// Post contracts-dag, most API type definitions live in `types/*/src` (see
// the contracts/type package split). We scan both roots for
// type references — contracts/ hosts the interfaces while types/ hosts the
// data shapes they reference (ChartConfig, AxisConfig, …).
const TYPES_SRC_DIR = path.resolve(REPO_ROOT, 'types');
const TYPES_API_DIR = path.resolve(REPO_ROOT, 'types/api/src/api');
const OUTPUT_FILE = path.resolve(REPO_ROOT, 'runtime/sdk/src/generated/api-spec.json');
const OUTPUT_SCHEMA_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-spec.schema.json',
);
const SDK_PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.resolve(REPO_ROOT, 'runtime/sdk/package.json'), 'utf-8'),
) as { name: string; version: string };
const GUIDANCE_TARGETS_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-guidance-targets.json',
);
const GUIDANCE_TARGETS_SCHEMA_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-guidance-targets.schema.json',
);
const API_GUIDANCE_FILE = path.resolve(REPO_ROOT, 'runtime/sdk/src/generated/api-guidance.json');
const API_GUIDANCE_SCHEMA_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-guidance.schema.json',
);
const API_COMPATIBILITY_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-compatibility.json',
);
const API_COMPATIBILITY_SCHEMA_FILE = path.resolve(
  REPO_ROOT,
  'runtime/sdk/src/generated/api-compatibility.schema.json',
);
const SCHEMA_VERSION = '1';
const API_COMPATIBILITY_INDEX = generateApiCompatibilityIndex(apiCompatibilityRegistry);

// ---------------------------------------------------------------------------
// Exclude lists (OK to hand-maintain — these hide internal plumbing)
// ---------------------------------------------------------------------------

const WORKBOOK_EXCLUDED_MEMBERS = new Set([
  'pivot',
  'charts',
  'ink',
  'floatingObjects',
  'records',
  'services',
  'emit',
  'setPendingUndoDescription',
  'setPendingSelectionCheckpoint',
  'createCalculatorContext',
  'recalculateAll',
  'recalculateSheet',
  'refreshViewport',
  'suspendCalc',
  'resumeCalc',
]);

const WORKSHEET_EXCLUDED_MEMBERS = new Set(['_internal', 'cellMetadata', 'viewport', 'emit']);

/** Built-in TypeScript/JS types to skip when collecting type references. */
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
  'T',
  'K',
  'V',
  'E',
  'R',
  // Internal kernel types not useful for agents
  'InternalEventType',
  'EventByType',
  'SpreadsheetEvent',
  'SelectionCheckpoint',
  // Root interfaces (they're not "types" in the output sense)
  'Workbook',
  'Worksheet',
]);

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function readFile(filePath: string): ts.SourceFile {
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

function getJSDocText(node: ts.Node): string {
  const fullText = node.getFullText();
  const nodeStart = node.getFullStart();
  const nodePos = node.getStart();
  const leadingTrivia = fullText.substring(0, nodePos - nodeStart);

  const match = leadingTrivia.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return '';

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function getSignatureText(member: ts.TypeElement, sourceFile: ts.SourceFile): string {
  const text = member.getText(sourceFile);
  const withoutComment = text.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
  return withoutComment
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n\s+\n/g, '\n');
}

function toRepoPath(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function getSourceLocation(sourceFile: ts.SourceFile): SourceLocation {
  return {
    file: toRepoPath(sourceFile.fileName),
  };
}

const packageNameCache = new Map<string, string>();
function getOwnerPackage(filePath: string): string {
  let dir = path.dirname(filePath);
  while (dir.startsWith(REPO_ROOT)) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      if (!packageNameCache.has(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
          name?: string;
        };
        packageNameCache.set(packageJsonPath, packageJson.name ?? '@mog/spreadsheet');
      }
      return packageNameCache.get(packageJsonPath)!;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '@mog/spreadsheet';
}

function compactTypeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\]<>,:;|&=])\s*/g, '$1')
    .trim();
}

/** Extract all PascalCase identifiers that look like domain type references. */
function collectTypeRefs(signature: string): string[] {
  const seen = new Set<string>();
  const matches = signature.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g);
  for (const [, name] of matches) {
    if (!BUILTIN_TYPE_NAMES.has(name)) {
      seen.add(name);
    }
  }
  return [...seen];
}

/** For overloaded members, prefer the most agent-friendly overload. */
function pickOverload(overloads: ts.TypeElement[], sourceFile: ts.SourceFile): ts.TypeElement {
  if (overloads.length === 1) return overloads[0];

  const nonGenericOverload = overloads.find(
    (o) => ts.isMethodSignature(o) && !o.typeParameters?.length,
  );
  if (nonGenericOverload) return nonGenericOverload;

  for (const overload of overloads) {
    if (ts.isMethodSignature(overload) && overload.parameters.length > 0) {
      const firstParam = overload.parameters[0];
      const typeText = firstParam.type?.getText(sourceFile) ?? '';
      if (typeText === 'string') return overload;
    }
  }
  return overloads[0];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiRoot = 'workbook' | 'worksheet' | 'subApi';
type ParentAlias = 'wb' | 'ws';
type Visibility = 'public' | 'internal' | 'deprecated';
type ApiMemberKind = 'method' | 'property' | 'subApiAccessor';
type AsyncModel = 'sync' | 'promise';

interface SourceLocation {
  file: string;
  line?: number;
}

interface OwnershipMetadata {
  package: string;
}

interface AliasMetadata {
  aliasOf: string | null;
  aliases: string[];
  replacement: string | null;
}

interface DeprecationMetadata {
  deprecated: boolean;
  message: string | null;
  replacement: string | null;
  since: string | null;
}

type NormalizedType =
  | { kind: 'primitive'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'array'; items: NormalizedType }
  | { kind: 'tuple'; items: NormalizedType[] }
  | { kind: 'objectRef'; name: string }
  | { kind: 'function'; params: ParameterEntry[]; returns: NormalizedType }
  | { kind: 'promise'; inner: NormalizedType }
  | { kind: 'union'; items: NormalizedType[] }
  | { kind: 'intersection'; items: NormalizedType[] }
  | { kind: 'record'; key: NormalizedType; value: NormalizedType }
  | { kind: 'unknown' }
  | { kind: 'void' };

interface ParameterEntry {
  name: string;
  position: number;
  optional: boolean;
  rest: boolean;
  default: string | null;
  type: NormalizedType;
  typeText: string;
}

interface ReturnEntry {
  type: NormalizedType;
  typeText: string;
}

interface TypeScriptTextEntry {
  signature: string;
  parameters: Array<{ name: string; typeText: string }>;
  returnTypeText: string;
}

interface FunctionEntry {
  signature: string;
  docstring: string;
  usedTypes: string[];
  stableId: string;
  canonicalPath: string;
  root: ApiRoot;
  parentRoot?: 'workbook' | 'worksheet';
  interface: string;
  method: string;
  kind: ApiMemberKind;
  visibility: Visibility;
  asyncModel: AsyncModel;
  parameters: ParameterEntry[];
  returns: ReturnEntry;
  typeScript: TypeScriptTextEntry;
  ownership: OwnershipMetadata;
  ownerPackage: string;
  alias: AliasMetadata;
  deprecation: DeprecationMetadata;
  compatibility: ApiCompatibilityReference[];
  source: SourceLocation;
  targetInterface?: string;
}

interface InterfaceEntry {
  docstring: string;
  source: SourceLocation;
  ownership: OwnershipMetadata;
  ownerPackage: string;
  members: Record<string, FunctionEntry>;
  functions: Record<string, FunctionEntry>;
}

interface TypeEntry {
  name: string;
  definition?: string;
  isEnum?: boolean;
  values?: Record<string, string>;
  docstring?: string;
  source: SourceLocation;
  ownership: OwnershipMetadata;
  ownerPackage: string;
}

interface ApiSpecPackageMetadata {
  name: '@mog-sdk/sdk';
  version: string;
}

interface ApiSpec {
  schemaVersion: '1';
  package: ApiSpecPackageMetadata;
  compatibility: ApiCompatibilityIndex;
  subApis: {
    workbook: Record<string, FunctionEntry>;
    worksheet: Record<string, FunctionEntry>;
  };
  interfaces: Record<string, InterfaceEntry>;
  types: Record<string, TypeEntry>;
  formatPresets?: Record<
    string,
    Record<string, { code: string; example: string; description?: string }>
  >;
  defaultFormats?: Record<string, string>;
}

interface ApiGuidanceTarget {
  schemaVersion: '1';
  path: string;
  stableId: string;
  root: ApiRoot;
  parentRoot?: 'workbook' | 'worksheet';
  interface: string;
  member: string;
  kind: ApiMemberKind;
  visibility: Visibility;
  asyncModel: AsyncModel;
  signature: string;
  typeText: string;
  compatibility: ApiCompatibilityReference[];
  targetInterface?: string;
  source: SourceLocation;
  ownerPackage: string;
}

interface ApiGuidanceTargets {
  schemaVersion: '1';
  targets: ApiGuidanceTarget[];
  byPath: Record<string, ApiGuidanceTarget>;
}

interface ApiGuidanceCatalogOutput {
  schemaVersion: '1';
  entries: typeof apiGuidanceCatalog;
  compatibility: ApiCompatibilityIndex;
}

function literalValueFromNode(
  node: ts.LiteralTypeNode['literal'],
  sourceFile: ts.SourceFile,
): string | number | boolean | null {
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  return compactTypeText(node.getText(sourceFile));
}

function normalizeTypeNode(
  node: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): NormalizedType {
  if (!node) return { kind: 'unknown' };

  if (ts.isParenthesizedTypeNode(node)) {
    return normalizeTypeNode(node.type, sourceFile);
  }

  if (ts.isArrayTypeNode(node)) {
    return { kind: 'array', items: normalizeTypeNode(node.elementType, sourceFile) };
  }

  if (ts.isTupleTypeNode(node)) {
    return {
      kind: 'tuple',
      items: node.elements.map((element) => {
        if (ts.isNamedTupleMember(element)) return normalizeTypeNode(element.type, sourceFile);
        if (ts.isRestTypeNode(element)) return normalizeTypeNode(element.type, sourceFile);
        return normalizeTypeNode(element, sourceFile);
      }),
    };
  }

  if (ts.isUnionTypeNode(node)) {
    return { kind: 'union', items: node.types.map((item) => normalizeTypeNode(item, sourceFile)) };
  }

  if (ts.isIntersectionTypeNode(node)) {
    return {
      kind: 'intersection',
      items: node.types.map((item) => normalizeTypeNode(item, sourceFile)),
    };
  }

  if (ts.isLiteralTypeNode(node)) {
    return { kind: 'literal', value: literalValueFromNode(node.literal, sourceFile) };
  }

  if (ts.isFunctionTypeNode(node)) {
    return {
      kind: 'function',
      params: node.parameters.map((param, index) => createParameterEntry(param, index, sourceFile)),
      returns: normalizeTypeNode(node.type, sourceFile),
    };
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(sourceFile);
    const args = node.typeArguments ?? [];
    if (name === 'Promise' && args.length === 1) {
      return { kind: 'promise', inner: normalizeTypeNode(args[0], sourceFile) };
    }
    if ((name === 'Array' || name === 'ReadonlyArray') && args.length === 1) {
      return { kind: 'array', items: normalizeTypeNode(args[0], sourceFile) };
    }
    if (name === 'Record' && args.length === 2) {
      return {
        kind: 'record',
        key: normalizeTypeNode(args[0], sourceFile),
        value: normalizeTypeNode(args[1], sourceFile),
      };
    }
    return { kind: 'objectRef', name: compactTypeText(node.getText(sourceFile)) };
  }

  if (ts.isTypeLiteralNode(node)) {
    const indexSignature = node.members.find(ts.isIndexSignatureDeclaration);
    if (indexSignature?.parameters.length === 1 && indexSignature.type) {
      return {
        kind: 'record',
        key: normalizeTypeNode(indexSignature.parameters[0].type, sourceFile),
        value: normalizeTypeNode(indexSignature.type, sourceFile),
      };
    }
    return { kind: 'objectRef', name: compactTypeText(node.getText(sourceFile)) };
  }

  if (ts.isTypeOperatorNode(node)) {
    if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return normalizeTypeNode(node.type, sourceFile);
    }
    return { kind: 'objectRef', name: compactTypeText(node.getText(sourceFile)) };
  }

  if (
    ts.isIndexedAccessTypeNode(node) ||
    ts.isConditionalTypeNode(node) ||
    ts.isInferTypeNode(node)
  ) {
    return { kind: 'objectRef', name: compactTypeText(node.getText(sourceFile)) };
  }

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: 'primitive', name: 'string' };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: 'primitive', name: 'number' };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: 'primitive', name: 'boolean' };
    case ts.SyntaxKind.BigIntKeyword:
      return { kind: 'primitive', name: 'bigint' };
    case ts.SyntaxKind.SymbolKeyword:
      return { kind: 'primitive', name: 'symbol' };
    case ts.SyntaxKind.ObjectKeyword:
      return { kind: 'primitive', name: 'object' };
    case ts.SyntaxKind.VoidKeyword:
      return { kind: 'void' };
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: 'unknown' };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.NeverKeyword:
      return { kind: 'unknown' };
    case ts.SyntaxKind.UndefinedKeyword:
      return { kind: 'literal', value: 'undefined' };
    default:
      return { kind: 'objectRef', name: compactTypeText(node.getText(sourceFile)) };
  }
}

function createParameterEntry(
  param: ts.ParameterDeclaration,
  position: number,
  sourceFile: ts.SourceFile,
): ParameterEntry {
  const initializer = param.initializer?.getText(sourceFile) ?? null;
  const typeText = compactTypeText(param.type?.getText(sourceFile) ?? 'unknown');
  return {
    name: param.name.getText(sourceFile),
    position,
    optional: Boolean(param.questionToken || initializer),
    rest: Boolean(param.dotDotDotToken),
    default: initializer,
    type: normalizeTypeNode(param.type, sourceFile),
    typeText,
  };
}

function getMemberKind(member: ts.TypeElement): Extract<ApiMemberKind, 'method' | 'property'> {
  return ts.isMethodSignature(member) ? 'method' : 'property';
}

function getMemberReturnTypeNode(member: ts.TypeElement): ts.TypeNode | undefined {
  if (ts.isMethodSignature(member)) return member.type;
  if (ts.isPropertySignature(member)) return member.type;
  return undefined;
}

function getMemberParameters(member: ts.TypeElement, sourceFile: ts.SourceFile): ParameterEntry[] {
  if (!ts.isMethodSignature(member)) return [];
  return member.parameters.map((param, index) => createParameterEntry(param, index, sourceFile));
}

function getPropertyTargetInterface(
  member: ts.TypeElement,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!ts.isPropertySignature(member)) return undefined;
  const typeText = member.type?.getText(sourceFile) ?? '';
  if (!/^[A-Z][A-Za-z0-9]+$/.test(typeText)) return undefined;
  if (BUILTIN_TYPE_NAMES.has(typeText)) return undefined;
  return findInterfaceFile(typeText) ? typeText : undefined;
}

function isPromiseTypeNode(node: ts.TypeNode | undefined): boolean {
  return Boolean(
    node &&
    ts.isTypeReferenceNode(node) &&
    node.typeName.getText() === 'Promise' &&
    node.typeArguments?.length === 1,
  );
}

function parseDeprecation(docstring: string): DeprecationMetadata {
  const match = docstring.match(/@deprecated\s*([^\n]*(?:\n(?!@)\s*[^\n]*)*)?/);
  const message = match?.[1]?.trim() || null;
  const replacement = message?.match(/use\s+`([^`]+)`/i)?.[1] ?? null;
  return {
    deprecated: Boolean(match),
    message,
    replacement,
    since: null,
  };
}

function createMemberEntry(options: {
  interfaceName: string;
  memberName: string;
  member: ts.TypeElement;
  sourceFile: ts.SourceFile;
  canonicalPath: string;
  root: ApiRoot;
  parentRoot?: 'workbook' | 'worksheet';
  kind: ApiMemberKind;
  targetInterface?: string;
}): FunctionEntry {
  const {
    interfaceName,
    memberName,
    member,
    sourceFile,
    canonicalPath,
    root,
    parentRoot,
    kind,
    targetInterface,
  } = options;
  const signature = getSignatureText(member, sourceFile);
  const docstring = getJSDocText(member);
  const returnTypeNode = getMemberReturnTypeNode(member);
  const parameters = kind === 'subApiAccessor' ? [] : getMemberParameters(member, sourceFile);
  const returnTypeText = compactTypeText(returnTypeNode?.getText(sourceFile) ?? 'unknown');
  const deprecation = parseDeprecation(docstring);
  const ownerPackage = getOwnerPackage(sourceFile.fileName);

  return {
    signature,
    docstring,
    usedTypes: collectTypeRefs(signature),
    stableId: `${interfaceName}.${memberName}`,
    canonicalPath,
    root,
    ...(parentRoot ? { parentRoot } : {}),
    interface: interfaceName,
    method: memberName,
    kind,
    visibility: deprecation.deprecated ? 'deprecated' : 'public',
    asyncModel: isPromiseTypeNode(returnTypeNode) ? 'promise' : 'sync',
    parameters,
    returns: {
      type: normalizeTypeNode(returnTypeNode, sourceFile),
      typeText: returnTypeText,
    },
    typeScript: {
      signature,
      parameters: parameters.map((param) => ({ name: param.name, typeText: param.typeText })),
      returnTypeText,
    },
    ownership: { package: ownerPackage },
    ownerPackage,
    alias: {
      aliasOf: null,
      aliases: [],
      replacement: null,
    },
    deprecation,
    compatibility: compatibilityReferencesForPath(API_COMPATIBILITY_INDEX, canonicalPath),
    source: getSourceLocation(sourceFile),
    ...(targetInterface ? { targetInterface } : {}),
  };
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

// ---------------------------------------------------------------------------
// Step 1: Parse root interfaces and auto-discover sub-APIs
// ---------------------------------------------------------------------------

interface SubApiInfo {
  accessor: string; // e.g. "charts"
  interfaceName: string; // e.g. "WorksheetCharts"
  parent: ParentAlias;
  member: ts.PropertySignature;
  sourceFile: ts.SourceFile;
}

/**
 * Scan a root interface for readonly property signatures whose type
 * references another interface (PascalCase name starting with Workbook/Worksheet).
 * These are the sub-API accessors.
 */
function discoverSubApis(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  parent: ParentAlias,
  excludedMembers: Set<string>,
): SubApiInfo[] {
  const results: SubApiInfo[] = [];

  for (const member of node.members) {
    if (!ts.isPropertySignature(member)) continue;

    const name = member.name?.getText(sourceFile) ?? '';
    if (!name || excludedMembers.has(name)) continue;

    // Must be readonly
    const isReadonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
    if (!isReadonly) continue;

    // Get the type text
    const typeText = member.type?.getText(sourceFile) ?? '';

    // Must reference a PascalCase interface name (Workbook* or Worksheet*)
    // Skip primitives, generic types, union types, etc.
    const match = typeText.match(/^(Workbook\w+|Worksheet\w+)$/);
    if (!match) continue;

    const interfaceName = match[1];

    // Skip internal interfaces
    if (interfaceName === 'WorksheetInternal') continue;

    results.push({ accessor: name, interfaceName, parent, member, sourceFile });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 2: Extract methods from an interface
// ---------------------------------------------------------------------------

function extractInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  excludedMembers: Set<string>,
  options: {
    root: ApiRoot;
    pathPrefix: string;
    parentRoot?: 'workbook' | 'worksheet';
    skipMembers?: Set<string>;
  } = { root: 'subApi', pathPrefix: node.name.text },
): InterfaceEntry {
  const docstring = getJSDocText(node);
  const ownerPackage = getOwnerPackage(sourceFile.fileName);
  const members: Record<string, FunctionEntry> = {};
  const functions: Record<string, FunctionEntry> = {};
  const skipMembers = options.skipMembers ?? new Set<string>();

  const byName = new Map<string, ts.TypeElement[]>();
  for (const member of node.members) {
    const name = (member as any).name?.getText(sourceFile) ?? '';
    if (!name || excludedMembers.has(name) || skipMembers.has(name)) continue;

    if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue;

    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(member);
  }

  for (const [name, overloads] of byName) {
    const chosen = pickOverload(overloads, sourceFile);
    const entry = createMemberEntry({
      interfaceName: node.name.text,
      memberName: name,
      member: chosen,
      sourceFile,
      canonicalPath: `${options.pathPrefix}.${name}`,
      root: options.root,
      ...(options.parentRoot ? { parentRoot: options.parentRoot } : {}),
      kind: getMemberKind(chosen),
      ...(getPropertyTargetInterface(chosen, sourceFile)
        ? { targetInterface: getPropertyTargetInterface(chosen, sourceFile) }
        : {}),
    });

    members[name] = entry;
    functions[name] = entry;
  }

  return {
    docstring,
    source: getSourceLocation(sourceFile),
    ownership: { package: ownerPackage },
    ownerPackage,
    members: sortRecord(members),
    functions: sortRecord(functions),
  };
}

function extractSubApiInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  pathPrefix: string,
  parentRoot: 'workbook' | 'worksheet',
): InterfaceEntry {
  return extractInterface(node, sourceFile, new Set(), {
    root: 'subApi',
    pathPrefix,
    parentRoot,
  });
}

// ---------------------------------------------------------------------------
// Step 3: Find interface declarations across source files
// ---------------------------------------------------------------------------

/**
 * Shared ts-morph project used to resolve interface declarations through
 * re-export shims. Loaded lazily on first use.
 *
 * Why ts-morph: after the contracts-dag migration, files like
 * `contracts/src/api/workbook.ts` may be one-line re-export shims
 * (`export * from '@mog/types-api/api/workbook'`). Plain regex / vanilla
 * `ts.forEachChild` parsing misses these redirects. ts-morph gives us
 * real module resolution (`ExportDeclaration.getModuleSpecifierSourceFile`)
 * so we can follow shims transitively to the canonical declaration.
 */
let _morphProject: Project | null = null;
function getMorphProject(): Project {
  if (_morphProject) return _morphProject;
  const tsconfigPath = path.resolve(REPO_ROOT, 'contracts/tsconfig.json');
  _morphProject = new Project({
    tsConfigFilePath: fs.existsSync(tsconfigPath) ? tsconfigPath : undefined,
    // Don't add all project files up-front — we add them on demand as we
    // resolve through re-exports. This keeps startup cheap.
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      // Match contracts' module resolution so `@mog/...` workspace imports
      // resolve the same way they do in a regular `tsc` build.
      ...(fs.existsSync(tsconfigPath) ? {} : { allowJs: false }),
    },
  });
  return _morphProject;
}

/**
 * Resolve the canonical file path + name of an interface, starting from
 * `filePath` and following `export * from 'X'` and `export { Name } from 'X'`
 * re-exports transitively. Returns `null` if no declaration is found.
 *
 * This uses ts-morph only for module resolution — the actual declaration is
 * returned as a vanilla `ts.InterfaceDeclaration` parsed by this project's
 * own TypeScript version. That's important: ts-morph bundles its own
 * TypeScript whose `SyntaxKind` numeric values may differ from ours, so
 * feeding a ts-morph-sourced node to our `ts.isPropertySignature` etc.
 * checks silently returns false and downstream extraction produces empty
 * results.
 */
function resolveInterfaceDeclaration(
  filePath: string,
  interfaceName: string,
): { node: ts.InterfaceDeclaration; sourceFile: ts.SourceFile; filePath: string } | null {
  const project = getMorphProject();
  const visited = new Set<string>();

  function visit(
    source: MorphSourceFile,
    searchName: string,
  ): { canonicalPath: string; canonicalName: string } | null {
    const absPath = source.getFilePath();
    const key = `${absPath}::${searchName}`;
    if (visited.has(key)) return null;
    visited.add(key);

    // 1. Direct declaration in this file.
    if (source.getInterface(searchName)) {
      return { canonicalPath: absPath, canonicalName: searchName };
    }

    // 2. Follow re-exports.
    for (const exportDecl of source.getExportDeclarations()) {
      // Only `export ... from '...'` forms redirect to another file.
      if (!exportDecl.hasModuleSpecifier()) continue;

      const targetSource = exportDecl.getModuleSpecifierSourceFile();
      if (!targetSource) continue; // Unresolvable module specifier — skip.

      // `export * as ns from 'X'` wraps everything under a namespace name;
      // skip, since we're looking for a bare interface identifier.
      // Note: `isNamespaceExport()` returns true for BOTH `* as ns` and
      // bare `*`; use `getNamespaceExport()` (which is undefined for bare
      // `*`) to distinguish them.
      if (exportDecl.getNamespaceExport()) continue;

      if (exportDecl.hasNamedExports()) {
        // `export { Name } from 'X'` or `export { Local as Name } from 'X'`
        for (const spec of exportDecl.getNamedExports()) {
          const exportedName = spec.getAliasNode()?.getText() ?? spec.getName();
          if (exportedName !== searchName) continue;
          // The name to look for in the target file is the original name
          // (pre-alias). If no alias, same as searchName.
          const originalName = spec.getName();
          const found = visit(targetSource, originalName);
          if (found) return found;
        }
        continue;
      }

      // Bare `export * from 'X'` — re-exports every declaration under its
      // original name.
      const found = visit(targetSource, searchName);
      if (found) return found;
    }

    return null;
  }

  // ts-morph needs the file to be added before resolution works.
  const startSource = project.addSourceFileAtPathIfExists(filePath);
  if (!startSource) return null;
  const canonical = visit(startSource, interfaceName);
  if (!canonical) return null;

  // Re-parse the canonical file with our own TypeScript so the returned
  // `ts.InterfaceDeclaration` is compatible with this project's AST
  // predicates (see comment above the function).
  const sourceFile = readFile(canonical.canonicalPath);
  let node: ts.InterfaceDeclaration | null = null;
  ts.forEachChild(sourceFile, (child) => {
    if (ts.isInterfaceDeclaration(child) && child.name.text === canonical.canonicalName) {
      node = child;
    }
  });
  if (!node) return null;
  return { node, sourceFile, filePath: canonical.canonicalPath };
}

/**
 * Locate the .ts file containing a given interface name within the API roots.
 * Follows re-export shims via ts-morph so a barrel/shim file still resolves
 * to the canonical declaration.
 */
function collectDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];

  const dirs = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      dirs.push(...collectDirectories(path.join(root, entry.name)));
    }
  }
  return dirs;
}

function findInterfaceFile(interfaceName: string): string | null {
  const searchDirs = [
    ...collectDirectories(TYPES_API_DIR),
    ...collectDirectories(CONTRACTS_API_DIR),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts') || file === 'index.ts') continue;
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      // Quick-skip files that clearly can't contribute this interface. A file
      // may contribute either by declaring the interface directly (name appears
      // literally) or by re-exporting from another module via `export *` /
      // `export { … } from …`. Re-export shims rarely contain the interface
      // name literally, so we fall through to ts-morph resolution whenever an
      // `export … from` clause exists.
      const hasReExport = /\bexport\s+(?:\*|\{)[\s\S]*?\bfrom\b/.test(content);
      if (!content.includes(interfaceName) && !hasReExport) continue;

      const resolved = resolveInterfaceDeclaration(filePath, interfaceName);
      if (resolved) return resolved.filePath;
    }
  }
  return null;
}

function parseInterfaceFromFile(
  filePath: string,
  interfaceName: string,
): { node: ts.InterfaceDeclaration; sourceFile: ts.SourceFile } | null {
  const resolved = resolveInterfaceDeclaration(filePath, interfaceName);
  if (!resolved) return null;
  return { node: resolved.node, sourceFile: resolved.sourceFile };
}

// ---------------------------------------------------------------------------
// Step 4: Collect referenced types
// ---------------------------------------------------------------------------

/**
 * Search multiple source files for type/interface/enum definitions.
 * Returns all found types as TypeEntry records.
 */
function findTypeDefinitions(
  typeNames: Set<string>,
  searchFiles: string[],
): Record<string, TypeEntry> {
  const result: Record<string, TypeEntry> = {};
  const remaining = new Set(typeNames);

  for (const filePath of searchFiles) {
    if (!fs.existsSync(filePath) || remaining.size === 0) continue;
    const sourceFile = readFile(filePath);

    ts.forEachChild(sourceFile, (node) => {
      // --- Enum declarations ---
      if (ts.isEnumDeclaration(node)) {
        const name = node.name.text;
        if (!remaining.has(name)) return;
        remaining.delete(name);

        const docstring = getJSDocText(node);
        const ownerPackage = getOwnerPackage(sourceFile.fileName);
        const values: Record<string, string> = {};
        for (const member of node.members) {
          const memberName = member.name.getText(sourceFile);
          const value =
            member.initializer?.getText(sourceFile) ?? String(Object.keys(values).length);
          values[memberName] = value;
        }
        result[name] = {
          name,
          isEnum: true,
          values: sortRecord(values),
          docstring,
          source: getSourceLocation(sourceFile),
          ownership: { package: ownerPackage },
          ownerPackage,
        };
      }

      // --- Type alias declarations ---
      else if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        if (!remaining.has(name)) return;
        remaining.delete(name);

        const docstring = getJSDocText(node);
        const definition = node.type.getText(sourceFile);
        const ownerPackage = getOwnerPackage(sourceFile.fileName);
        result[name] = {
          name,
          definition,
          docstring,
          source: getSourceLocation(sourceFile),
          ownership: { package: ownerPackage },
          ownerPackage,
        };
      }

      // --- Interface declarations (data shape interfaces) ---
      else if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        if (!remaining.has(name)) return;
        remaining.delete(name);

        const docstring = getJSDocText(node);
        const ownerPackage = getOwnerPackage(sourceFile.fileName);
        // Serialize properties into a definition string
        const parts: string[] = [];
        for (const member of node.members) {
          if (ts.isPropertySignature(member)) {
            const propName = member.name?.getText(sourceFile) ?? '';
            const optional = member.questionToken ? '?' : '';
            const typeText = member.type?.getText(sourceFile) ?? 'unknown';
            const propDoc = getJSDocText(member);
            if (propDoc) {
              parts.push(`  /** ${propDoc} */`);
            }
            parts.push(`  ${propName}${optional}: ${typeText};`);
          } else if (ts.isMethodSignature(member)) {
            const sig = getSignatureText(member, sourceFile);
            const methodDoc = getJSDocText(member);
            if (methodDoc) {
              parts.push(`  /** ${methodDoc} */`);
            }
            parts.push(`  ${sig};`);
          }
        }

        result[name] = {
          name,
          definition: parts.length > 0 ? `{\n${parts.join('\n')}\n}` : '{}',
          docstring,
          source: getSourceLocation(sourceFile),
          ownership: { package: ownerPackage },
          ownerPackage,
        };
      }
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 5: Main generator
// ---------------------------------------------------------------------------

function generate(): ApiSpec {
  // --- Parse root interfaces ---
  const workbookFile = path.join(TYPES_API_DIR, 'workbook.ts');
  const worksheetFile = path.join(TYPES_API_DIR, 'worksheet.ts');

  const wbParsed = parseInterfaceFromFile(workbookFile, 'Workbook');
  const wsParsed = parseInterfaceFromFile(worksheetFile, 'Worksheet');

  if (!wbParsed) throw new Error('Could not find Workbook interface in workbook.ts');
  if (!wsParsed) throw new Error('Could not find Worksheet interface in worksheet.ts');

  // --- Step 1: Discover sub-APIs from readonly properties ---
  const wbSubApis = discoverSubApis(
    wbParsed.node,
    wbParsed.sourceFile,
    'wb',
    WORKBOOK_EXCLUDED_MEMBERS,
  );
  const wsSubApis = discoverSubApis(
    wsParsed.node,
    wsParsed.sourceFile,
    'ws',
    WORKSHEET_EXCLUDED_MEMBERS,
  );
  const allSubApis = [...wbSubApis, ...wsSubApis];

  const subApiMap: ApiSpec['subApis'] = { workbook: {}, worksheet: {} };
  for (const sa of allSubApis) {
    const parentRoot = sa.parent === 'wb' ? 'workbook' : 'worksheet';
    subApiMap[parentRoot][sa.accessor] = createMemberEntry({
      interfaceName: sa.parent === 'wb' ? 'Workbook' : 'Worksheet',
      memberName: sa.accessor,
      member: sa.member,
      sourceFile: sa.sourceFile,
      canonicalPath: `${sa.parent}.${sa.accessor}`,
      root: 'subApi',
      parentRoot,
      kind: 'subApiAccessor',
      targetInterface: sa.interfaceName,
    });
  }
  subApiMap.workbook = sortRecord(subApiMap.workbook);
  subApiMap.worksheet = sortRecord(subApiMap.worksheet);

  // --- Step 2: Extract root interface methods (excluding sub-API properties) ---
  const interfaces: Record<string, InterfaceEntry> = {};
  const wbAccessorNames = new Set(wbSubApis.map((sa) => sa.accessor));
  const wsAccessorNames = new Set(wsSubApis.map((sa) => sa.accessor));

  interfaces['Workbook'] = extractInterface(
    wbParsed.node,
    wbParsed.sourceFile,
    WORKBOOK_EXCLUDED_MEMBERS,
    { root: 'workbook', pathPrefix: 'wb', skipMembers: wbAccessorNames },
  );
  interfaces['Worksheet'] = extractInterface(
    wsParsed.node,
    wsParsed.sourceFile,
    WORKSHEET_EXCLUDED_MEMBERS,
    { root: 'worksheet', pathPrefix: 'ws', skipMembers: wsAccessorNames },
  );

  for (const sa of wbSubApis) {
    interfaces['Workbook'].members[sa.accessor] = subApiMap.workbook[sa.accessor];
  }
  interfaces['Workbook'].members = sortRecord(interfaces['Workbook'].members);
  for (const sa of wsSubApis) {
    interfaces['Worksheet'].members[sa.accessor] = subApiMap.worksheet[sa.accessor];
  }
  interfaces['Worksheet'].members = sortRecord(interfaces['Worksheet'].members);

  // --- Step 3: Find and parse sub-API interfaces, including nested namespaces ---
  const interfaceQueue: Array<{
    interfaceName: string;
    pathPrefix: string;
    parentRoot: 'workbook' | 'worksheet';
  }> = allSubApis.map((sa) => ({
    interfaceName: sa.interfaceName,
    pathPrefix: `${sa.parent}.${sa.accessor}`,
    parentRoot: sa.parent === 'wb' ? 'workbook' : 'worksheet',
  }));
  const processedInterfaces = new Set<string>();

  for (let index = 0; index < interfaceQueue.length; index++) {
    const item = interfaceQueue[index];
    const processKey = `${item.interfaceName}::${item.pathPrefix}`;
    if (processedInterfaces.has(processKey)) continue;
    processedInterfaces.add(processKey);

    const filePath = findInterfaceFile(item.interfaceName);
    if (!filePath) {
      console.warn(`[warn] Could not find file for interface: ${item.interfaceName}`);
      continue;
    }

    const parsed = parseInterfaceFromFile(filePath, item.interfaceName);
    if (!parsed) {
      console.warn(`[warn] Could not parse interface ${item.interfaceName} from ${filePath}`);
      continue;
    }

    const extracted = extractSubApiInterface(
      parsed.node,
      parsed.sourceFile,
      item.pathPrefix,
      item.parentRoot,
    );
    interfaces[item.interfaceName] = extracted;

    for (const member of Object.values(extracted.functions)) {
      if (member.kind !== 'property' || !member.targetInterface) continue;
      interfaceQueue.push({
        interfaceName: member.targetInterface,
        pathPrefix: member.canonicalPath,
        parentRoot: item.parentRoot,
      });
    }
  }

  // --- Step 4: Collect all referenced PascalCase types ---
  const allTypeRefs = new Set<string>();

  for (const [, iface] of Object.entries(interfaces)) {
    for (const [, fn] of Object.entries(iface.functions)) {
      for (const t of fn.usedTypes) {
        if (!BUILTIN_TYPE_NAMES.has(t) && !interfaces[t]) {
          allTypeRefs.add(t);
        }
      }
    }
  }

  // --- Step 5: Find type definitions across source files ---
  // Recursively collect all .ts files under contracts/src/ for type search.
  // The generator only resolves types that are transitively referenced from
  // API method signatures (via allTypeRefs), so scanning broadly is safe —
  // it widens the search space, not the result set.
  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(path.join(dir, entry.name)));
      } else if (entry.name.endsWith('.ts')) {
        files.push(path.join(dir, entry.name));
      }
    }
    return files;
  }

  // Scan both contracts/ and types/ — chart/pivot/etc. type definitions were
  // moved to `types/*/src` during the contracts-dag refactor, but the method
  // signatures that reference them still live in `contracts/src/api/`.
  // Skip `dist/` and `node_modules/` so we don't match compiled .d.ts copies
  // or dependency source.
  const skipSegments = [`${path.sep}dist${path.sep}`, `${path.sep}node_modules${path.sep}`];
  const typeSearchFiles = [
    ...collectTsFiles(CONTRACTS_SRC_DIR),
    ...collectTsFiles(TYPES_SRC_DIR).filter((p) => !skipSegments.some((s) => p.includes(s))),
  ];

  const types = findTypeDefinitions(allTypeRefs, typeSearchFiles);

  // --- Step 5b: Transitively collect types referenced inside type definitions ---
  // Types inside definitions (e.g., ChartConfig references ChartType) should also be included.
  let newRefs = new Set<string>();
  for (const [, typeEntry] of Object.entries(types)) {
    const def = typeEntry.definition ?? '';
    const refs = collectTypeRefs(def);
    for (const r of refs) {
      if (!types[r] && !BUILTIN_TYPE_NAMES.has(r) && !interfaces[r]) {
        newRefs.add(r);
      }
    }
    // Also check enum values text for references
    if (typeEntry.values) {
      for (const v of Object.values(typeEntry.values)) {
        const vRefs = collectTypeRefs(v);
        for (const r of vRefs) {
          if (!types[r] && !BUILTIN_TYPE_NAMES.has(r) && !interfaces[r]) {
            newRefs.add(r);
          }
        }
      }
    }
  }

  // Do up to 3 rounds of transitive resolution
  for (let round = 0; round < 3 && newRefs.size > 0; round++) {
    const found = findTypeDefinitions(newRefs, typeSearchFiles);
    for (const [name, entry] of Object.entries(found)) {
      types[name] = entry;
    }
    // Collect new refs from newly found types
    const nextRefs = new Set<string>();
    for (const name of newRefs) {
      const entry = types[name];
      if (!entry) continue;
      const def = entry.definition ?? '';
      const refs = collectTypeRefs(def);
      for (const r of refs) {
        if (!types[r] && !BUILTIN_TYPE_NAMES.has(r) && !interfaces[r]) {
          nextRefs.add(r);
        }
      }
    }
    newRefs = nextRefs;
  }

  // Sort types alphabetically for stable output
  const sortedTypes: Record<string, TypeEntry> = {};
  for (const key of Object.keys(types).sort()) {
    sortedTypes[key] = types[key];
  }
  const sortedInterfaces = sortRecord(interfaces);

  return {
    schemaVersion: SCHEMA_VERSION,
    package: {
      name: '@mog-sdk/sdk',
      version: SDK_PACKAGE_JSON.version,
    },
    compatibility: API_COMPATIBILITY_INDEX,
    subApis: subApiMap,
    interfaces: sortedInterfaces,
    types: sortedTypes,
    formatPresets: FORMAT_PRESETS as any,
    defaultFormats: DEFAULT_FORMAT_BY_TYPE,
  };
}

function generateGuidanceTargets(spec: ApiSpec): ApiGuidanceTargets {
  const byPath = new Map<string, ApiGuidanceTarget>();

  for (const iface of Object.values(spec.interfaces)) {
    for (const member of Object.values(iface.members)) {
      const target: ApiGuidanceTarget = {
        schemaVersion: SCHEMA_VERSION,
        path: member.canonicalPath,
        stableId: member.stableId,
        root: member.root,
        ...(member.parentRoot ? { parentRoot: member.parentRoot } : {}),
        interface: member.interface,
        member: member.method,
        kind: member.kind,
        visibility: member.visibility,
        asyncModel: member.asyncModel,
        signature: member.signature,
        typeText: member.returns.typeText,
        compatibility: member.compatibility,
        ...(member.targetInterface ? { targetInterface: member.targetInterface } : {}),
        source: member.source,
        ownerPackage: member.ownerPackage,
      };

      const existing = byPath.get(target.path);
      if (existing && existing.stableId !== target.stableId) {
        throw new Error(
          `Duplicate guidance target path ${target.path}: ${existing.stableId} vs ${target.stableId}`,
        );
      }
      byPath.set(target.path, target);
    }
  }

  const targets = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const byPathRecord: Record<string, ApiGuidanceTarget> = {};
  for (const target of targets) {
    byPathRecord[target.path] = target;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    targets,
    byPath: byPathRecord,
  };
}

function generateApiGuidanceCatalog(): ApiGuidanceCatalogOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: apiGuidanceCatalog,
    compatibility: API_COMPATIBILITY_INDEX,
  };
}

// ---------------------------------------------------------------------------
// Schema and self-validation
// ---------------------------------------------------------------------------

const API_SPEC_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mog.dev/schemas/api-spec.schema.json',
  title: 'Mog SDK API Spec',
  type: 'object',
  required: ['schemaVersion', 'package', 'compatibility', 'interfaces', 'subApis', 'types'],
  additionalProperties: true,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    package: {
      type: 'object',
      required: ['name', 'version'],
      additionalProperties: false,
      properties: {
        name: { const: '@mog-sdk/sdk' },
        version: { type: 'string', minLength: 1 },
      },
    },
    compatibility: { type: 'object', additionalProperties: true },
    interfaces: {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/interfaceEntry' },
    },
    subApis: {
      type: 'object',
      required: ['workbook', 'worksheet'],
      additionalProperties: false,
      properties: {
        workbook: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/functionEntry' },
        },
        worksheet: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/functionEntry' },
        },
      },
    },
    types: {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/typeEntry' },
    },
  },
  $defs: {
    sourceLocation: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', minLength: 1 },
        line: { type: 'integer', minimum: 1 },
      },
    },
    ownership: {
      type: 'object',
      required: ['package'],
      additionalProperties: false,
      properties: {
        package: { type: 'string', minLength: 1 },
      },
    },
    alias: {
      type: 'object',
      required: ['aliasOf', 'aliases', 'replacement'],
      additionalProperties: false,
      properties: {
        aliasOf: { type: ['string', 'null'] },
        aliases: { type: 'array', items: { type: 'string' } },
        replacement: { type: ['string', 'null'] },
      },
    },
    deprecation: {
      type: 'object',
      required: ['deprecated', 'message', 'replacement', 'since'],
      additionalProperties: false,
      properties: {
        deprecated: { type: 'boolean' },
        message: { type: ['string', 'null'] },
        replacement: { type: ['string', 'null'] },
        since: { type: ['string', 'null'] },
      },
    },
    parameter: {
      type: 'object',
      required: ['name', 'position', 'optional', 'rest', 'default', 'type', 'typeText'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        position: { type: 'integer', minimum: 0 },
        optional: { type: 'boolean' },
        rest: { type: 'boolean' },
        default: { type: ['string', 'null'] },
        type: { $ref: '#/$defs/normalizedType' },
        typeText: { type: 'string' },
      },
    },
    returnEntry: {
      type: 'object',
      required: ['type', 'typeText'],
      additionalProperties: false,
      properties: {
        type: { $ref: '#/$defs/normalizedType' },
        typeText: { type: 'string' },
      },
    },
    typeScriptText: {
      type: 'object',
      required: ['signature', 'parameters', 'returnTypeText'],
      additionalProperties: false,
      properties: {
        signature: { type: 'string' },
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'typeText'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              typeText: { type: 'string' },
            },
          },
        },
        returnTypeText: { type: 'string' },
      },
    },
    functionEntry: {
      type: 'object',
      required: [
        'signature',
        'docstring',
        'usedTypes',
        'stableId',
        'canonicalPath',
        'root',
        'interface',
        'method',
        'kind',
        'visibility',
        'asyncModel',
        'parameters',
        'returns',
        'typeScript',
        'ownership',
        'ownerPackage',
        'alias',
        'deprecation',
        'compatibility',
        'source',
      ],
      additionalProperties: true,
      properties: {
        signature: { type: 'string' },
        docstring: { type: 'string' },
        usedTypes: { type: 'array', items: { type: 'string' } },
        stableId: { type: 'string', minLength: 1 },
        canonicalPath: { type: 'string', pattern: '^(wb|ws)\\.' },
        root: { enum: ['workbook', 'worksheet', 'subApi'] },
        parentRoot: { enum: ['workbook', 'worksheet'] },
        interface: { type: 'string', minLength: 1 },
        method: { type: 'string', minLength: 1 },
        kind: { enum: ['method', 'property', 'subApiAccessor'] },
        visibility: { enum: ['public', 'internal', 'deprecated'] },
        asyncModel: { enum: ['sync', 'promise'] },
        parameters: { type: 'array', items: { $ref: '#/$defs/parameter' } },
        returns: { $ref: '#/$defs/returnEntry' },
        typeScript: { $ref: '#/$defs/typeScriptText' },
        ownership: { $ref: '#/$defs/ownership' },
        ownerPackage: { type: 'string', minLength: 1 },
        alias: { $ref: '#/$defs/alias' },
        deprecation: { $ref: '#/$defs/deprecation' },
        compatibility: {
          type: 'array',
          items: API_COMPATIBILITY_REFERENCE_SCHEMA,
        },
        source: { $ref: '#/$defs/sourceLocation' },
        targetInterface: { type: 'string' },
      },
    },
    interfaceEntry: {
      type: 'object',
      required: ['docstring', 'source', 'ownership', 'ownerPackage', 'members', 'functions'],
      additionalProperties: false,
      properties: {
        docstring: { type: 'string' },
        source: { $ref: '#/$defs/sourceLocation' },
        ownership: { $ref: '#/$defs/ownership' },
        ownerPackage: { type: 'string', minLength: 1 },
        members: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/functionEntry' },
        },
        functions: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/functionEntry' },
        },
      },
    },
    typeEntry: {
      type: 'object',
      required: ['name', 'source', 'ownership', 'ownerPackage'],
      additionalProperties: true,
      properties: {
        name: { type: 'string', minLength: 1 },
        definition: { type: 'string' },
        isEnum: { type: 'boolean' },
        values: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        docstring: { type: 'string' },
        source: { $ref: '#/$defs/sourceLocation' },
        ownership: { $ref: '#/$defs/ownership' },
        ownerPackage: { type: 'string', minLength: 1 },
      },
    },
    normalizedType: {
      oneOf: [
        {
          type: 'object',
          required: ['kind', 'name'],
          additionalProperties: false,
          properties: { kind: { const: 'primitive' }, name: { type: 'string', minLength: 1 } },
        },
        {
          type: 'object',
          required: ['kind', 'value'],
          additionalProperties: false,
          properties: {
            kind: { const: 'literal' },
            value: { type: ['string', 'number', 'boolean', 'null'] },
          },
        },
        {
          type: 'object',
          required: ['kind', 'items'],
          additionalProperties: false,
          properties: { kind: { const: 'array' }, items: { $ref: '#/$defs/normalizedType' } },
        },
        {
          type: 'object',
          required: ['kind', 'items'],
          additionalProperties: false,
          properties: {
            kind: { const: 'tuple' },
            items: { type: 'array', items: { $ref: '#/$defs/normalizedType' } },
          },
        },
        {
          type: 'object',
          required: ['kind', 'name'],
          additionalProperties: false,
          properties: { kind: { const: 'objectRef' }, name: { type: 'string', minLength: 1 } },
        },
        {
          type: 'object',
          required: ['kind', 'params', 'returns'],
          additionalProperties: false,
          properties: {
            kind: { const: 'function' },
            params: { type: 'array', items: { $ref: '#/$defs/parameter' } },
            returns: { $ref: '#/$defs/normalizedType' },
          },
        },
        {
          type: 'object',
          required: ['kind', 'inner'],
          additionalProperties: false,
          properties: { kind: { const: 'promise' }, inner: { $ref: '#/$defs/normalizedType' } },
        },
        {
          type: 'object',
          required: ['kind', 'items'],
          additionalProperties: false,
          properties: {
            kind: { enum: ['union', 'intersection'] },
            items: { type: 'array', items: { $ref: '#/$defs/normalizedType' } },
          },
        },
        {
          type: 'object',
          required: ['kind', 'key', 'value'],
          additionalProperties: false,
          properties: {
            kind: { const: 'record' },
            key: { $ref: '#/$defs/normalizedType' },
            value: { $ref: '#/$defs/normalizedType' },
          },
        },
        {
          type: 'object',
          required: ['kind'],
          additionalProperties: false,
          properties: { kind: { enum: ['unknown', 'void'] } },
        },
      ],
    },
  },
} as const;

const API_GUIDANCE_TARGETS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mog.dev/schemas/api-guidance-targets.schema.json',
  title: 'Mog SDK API Guidance Targets',
  type: 'object',
  required: ['schemaVersion', 'targets', 'byPath'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    targets: {
      type: 'array',
      items: { $ref: '#/$defs/apiGuidanceTarget' },
    },
    byPath: {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/apiGuidanceTarget' },
    },
  },
  $defs: {
    sourceLocation: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', minLength: 1 },
        line: { type: 'integer', minimum: 1 },
      },
    },
    apiGuidanceTarget: {
      type: 'object',
      required: [
        'schemaVersion',
        'path',
        'stableId',
        'root',
        'interface',
        'member',
        'kind',
        'visibility',
        'asyncModel',
        'signature',
        'typeText',
        'compatibility',
        'source',
        'ownerPackage',
      ],
      additionalProperties: false,
      properties: {
        schemaVersion: { const: SCHEMA_VERSION },
        path: { type: 'string', pattern: '^(wb|ws)\\.' },
        stableId: { type: 'string', minLength: 1 },
        root: { enum: ['workbook', 'worksheet', 'subApi'] },
        parentRoot: { enum: ['workbook', 'worksheet'] },
        interface: { type: 'string', minLength: 1 },
        member: { type: 'string', minLength: 1 },
        kind: { enum: ['method', 'property', 'subApiAccessor'] },
        visibility: { enum: ['public', 'internal', 'deprecated'] },
        asyncModel: { enum: ['sync', 'promise'] },
        signature: { type: 'string' },
        typeText: { type: 'string' },
        compatibility: {
          type: 'array',
          items: API_COMPATIBILITY_REFERENCE_SCHEMA,
        },
        targetInterface: { type: 'string' },
        source: { $ref: '#/$defs/sourceLocation' },
        ownerPackage: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;

const API_GUIDANCE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mog.dev/schemas/api-guidance.schema.json',
  title: 'Mog SDK API Guidance Catalog',
  type: 'object',
  required: ['schemaVersion', 'entries', 'compatibility'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    entries: {
      type: 'array',
      items: { $ref: '#/$defs/apiGuidanceEntry' },
    },
    compatibility: { type: 'object', additionalProperties: true },
  },
  $defs: {
    apiGuidanceEntry: {
      type: 'object',
      required: [
        'id',
        'dialect',
        'category',
        'matchers',
        'message',
        'suggestion',
        'mogReplacements',
        'confidence',
        'blocking',
      ],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        dialect: { enum: ['officejs', 'mog-version'] },
        category: {
          enum: [
            'bootstrap',
            'sync-load',
            'workbook',
            'worksheet',
            'range',
            'formatting',
            'tables',
            'filters',
            'compatibility',
            'charts',
            'pivots',
            'names',
            'file-io',
            'host',
          ],
        },
        matchers: {
          type: 'array',
          minItems: 1,
          items: {
            oneOf: [{ $ref: '#/$defs/symbolMatcher' }, { $ref: '#/$defs/compoundMatcher' }],
          },
        },
        message: { type: 'string', minLength: 1 },
        suggestion: { type: 'string', minLength: 1 },
        mogReplacements: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/mogReplacement' },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        blocking: { type: 'boolean' },
      },
    },
    symbolMatcher: {
      type: 'object',
      required: ['id', 'kind', 'symbol'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { enum: ['member-chain', 'call', 'assignment', 'token'] },
        symbol: { type: 'string', minLength: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        blocking: { type: 'boolean' },
      },
    },
    compoundMatcher: {
      type: 'object',
      required: ['id', 'kind', 'symbols', 'confidence', 'blocking'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { const: 'compound' },
        symbols: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        blocking: { type: 'boolean' },
      },
    },
    mogReplacement: {
      type: 'object',
      required: ['path'],
      additionalProperties: false,
      properties: {
        path: { type: 'string', minLength: 1 },
        snippet: { type: 'string' },
        note: { type: 'string' },
      },
    },
  },
} as const;

function assertNormalizedType(type: NormalizedType, pathLabel: string): void {
  switch (type.kind) {
    case 'primitive':
      if (!type.name) throw new Error(`${pathLabel}: primitive type missing name`);
      return;
    case 'literal':
      if (!Object.prototype.hasOwnProperty.call(type, 'value')) {
        throw new Error(`${pathLabel}: literal type missing value`);
      }
      return;
    case 'array':
      assertNormalizedType(type.items, `${pathLabel}.items`);
      return;
    case 'tuple':
    case 'union':
    case 'intersection':
      type.items.forEach((item, index) =>
        assertNormalizedType(item, `${pathLabel}.items[${index}]`),
      );
      return;
    case 'objectRef':
      if (!type.name) throw new Error(`${pathLabel}: objectRef type missing name`);
      return;
    case 'function':
      type.params.forEach((param, index) => {
        if (param.position !== index) {
          throw new Error(`${pathLabel}.params[${index}]: parameter position mismatch`);
        }
        assertNormalizedType(param.type, `${pathLabel}.params[${index}].type`);
      });
      assertNormalizedType(type.returns, `${pathLabel}.returns`);
      return;
    case 'promise':
      assertNormalizedType(type.inner, `${pathLabel}.inner`);
      return;
    case 'record':
      assertNormalizedType(type.key, `${pathLabel}.key`);
      assertNormalizedType(type.value, `${pathLabel}.value`);
      return;
    case 'unknown':
    case 'void':
      return;
    default: {
      const exhaustive: never = type;
      throw new Error(`${pathLabel}: unsupported normalized type ${(exhaustive as any).kind}`);
    }
  }
}

function assertFunctionEntry(entry: FunctionEntry, pathLabel: string): void {
  const requiredStringFields: Array<keyof FunctionEntry> = [
    'signature',
    'stableId',
    'canonicalPath',
    'interface',
    'method',
    'ownerPackage',
  ];
  for (const field of requiredStringFields) {
    if (typeof entry[field] !== 'string' || !(entry[field] as string).length) {
      throw new Error(`${pathLabel}: missing ${String(field)}`);
    }
  }
  if (!['workbook', 'worksheet', 'subApi'].includes(entry.root)) {
    throw new Error(`${pathLabel}: invalid root ${entry.root}`);
  }
  if (!['method', 'property', 'subApiAccessor'].includes(entry.kind)) {
    throw new Error(`${pathLabel}: invalid kind ${entry.kind}`);
  }
  if (!['public', 'internal', 'deprecated'].includes(entry.visibility)) {
    throw new Error(`${pathLabel}: invalid visibility ${entry.visibility}`);
  }
  if (!['sync', 'promise'].includes(entry.asyncModel)) {
    throw new Error(`${pathLabel}: invalid asyncModel ${entry.asyncModel}`);
  }
  if (!entry.source.file || (entry.source.line !== undefined && entry.source.line < 1)) {
    throw new Error(`${pathLabel}: invalid source`);
  }
  if (!Array.isArray(entry.compatibility)) {
    throw new Error(`${pathLabel}: missing compatibility references`);
  }
  entry.parameters.forEach((param, index) => {
    if (param.position !== index) {
      throw new Error(`${pathLabel}.parameters[${index}]: parameter position mismatch`);
    }
    assertNormalizedType(param.type, `${pathLabel}.parameters[${index}].type`);
  });
  assertNormalizedType(entry.returns.type, `${pathLabel}.returns.type`);
}

function assertApiSpec(spec: ApiSpec): void {
  if (spec.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`api spec schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (spec.package.name !== '@mog-sdk/sdk' || spec.package.version !== SDK_PACKAGE_JSON.version) {
    throw new Error(`api spec package metadata must be @mog-sdk/sdk@${SDK_PACKAGE_JSON.version}`);
  }
  if (!spec.subApis.workbook || !spec.subApis.worksheet) {
    throw new Error('api spec must contain subApis.workbook and subApis.worksheet');
  }
  for (const [interfaceName, entry] of Object.entries(spec.interfaces)) {
    if (!entry.source.file || (entry.source.line !== undefined && entry.source.line < 1)) {
      throw new Error(`${interfaceName}: invalid source`);
    }
    for (const [methodName, fn] of Object.entries(entry.functions)) {
      assertFunctionEntry(fn, `interfaces.${interfaceName}.functions.${methodName}`);
    }
    for (const [memberName, member] of Object.entries(entry.members)) {
      assertFunctionEntry(member, `interfaces.${interfaceName}.members.${memberName}`);
    }
  }
  for (const [name, accessor] of Object.entries(spec.subApis.workbook)) {
    assertFunctionEntry(accessor, `subApis.workbook.${name}`);
  }
  for (const [name, accessor] of Object.entries(spec.subApis.worksheet)) {
    assertFunctionEntry(accessor, `subApis.worksheet.${name}`);
  }
}

function assertGuidanceTargets(index: ApiGuidanceTargets): void {
  if (index.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`api guidance targets schemaVersion must be ${SCHEMA_VERSION}`);
  }
  const seen = new Set<string>();
  for (const target of index.targets) {
    if (!target.path || !/^(wb|ws)\./.test(target.path)) {
      throw new Error(`Invalid guidance target path: ${target.path}`);
    }
    if (seen.has(target.path)) {
      throw new Error(`Duplicate guidance target path: ${target.path}`);
    }
    seen.add(target.path);
    if (index.byPath[target.path] !== target) {
      throw new Error(`Guidance target ${target.path} missing from byPath index`);
    }
    if (!['method', 'property', 'subApiAccessor'].includes(target.kind)) {
      throw new Error(`Guidance target ${target.path} has invalid kind ${target.kind}`);
    }
    if (!['sync', 'promise'].includes(target.asyncModel)) {
      throw new Error(`Guidance target ${target.path} has invalid asyncModel ${target.asyncModel}`);
    }
    if (!target.source.file) {
      throw new Error(`Guidance target ${target.path} missing source file`);
    }
    if (!Array.isArray(target.compatibility)) {
      throw new Error(`Guidance target ${target.path} missing compatibility references`);
    }
  }
  for (const path of Object.keys(index.byPath)) {
    if (!seen.has(path)) {
      throw new Error(`Guidance byPath contains non-target path: ${path}`);
    }
  }
}

function assertApiGuidanceCatalog(
  catalog: ApiGuidanceCatalogOutput,
  targets: ApiGuidanceTargets,
): void {
  if (catalog.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`api guidance schemaVersion must be ${SCHEMA_VERSION}`);
  }

  const entryIds = new Set<string>();
  const matcherIds = new Set<string>();

  for (const entry of catalog.entries) {
    if (entryIds.has(entry.id)) {
      throw new Error(`Duplicate API guidance entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
    if (entry.confidence < 0 || entry.confidence > 1) {
      throw new Error(`API guidance entry ${entry.id} confidence must be in [0, 1]`);
    }

    for (const matcher of entry.matchers) {
      if (matcherIds.has(matcher.id)) {
        throw new Error(`Duplicate API guidance matcher id: ${matcher.id}`);
      }
      matcherIds.add(matcher.id);
    }

    for (const replacement of entry.mogReplacements) {
      if (documentedRootGuidancePaths.has(replacement.path)) continue;
      if (!targets.byPath[replacement.path]) {
        throw new Error(
          `API guidance replacement ${entry.id} -> ${replacement.path} does not resolve in generated guidance targets`,
        );
      }
    }
  }
}

function writeGeneratedFile(filePath: string, value: unknown): void {
  const newContent = JSON.stringify(value, null, 2) + '\n';
  const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  if (newContent === existingContent) {
    console.log(`Unchanged: ${filePath}\n`);
  } else {
    fs.writeFileSync(filePath, newContent);
    console.log(`Written: ${filePath}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating SDK API spec from contracts/src/api/...\n');

const spec = generate();
assertApiSpec(spec);
const guidanceTargets = generateGuidanceTargets(spec);
assertGuidanceTargets(guidanceTargets);
assertApiCompatibilityIndex(API_COMPATIBILITY_INDEX, guidanceTargets);
const guidanceCatalog = generateApiGuidanceCatalog();
assertApiGuidanceCatalog(guidanceCatalog, guidanceTargets);

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

// Only write if content actually changed (avoids noisy diffs on publish)
writeGeneratedFile(OUTPUT_SCHEMA_FILE, API_SPEC_SCHEMA);
writeGeneratedFile(OUTPUT_FILE, spec);
writeGeneratedFile(API_COMPATIBILITY_SCHEMA_FILE, API_COMPATIBILITY_SCHEMA);
writeGeneratedFile(API_COMPATIBILITY_FILE, API_COMPATIBILITY_INDEX);
writeGeneratedFile(API_GUIDANCE_SCHEMA_FILE, API_GUIDANCE_SCHEMA);
writeGeneratedFile(API_GUIDANCE_FILE, guidanceCatalog);
writeGeneratedFile(GUIDANCE_TARGETS_SCHEMA_FILE, API_GUIDANCE_TARGETS_SCHEMA);
writeGeneratedFile(GUIDANCE_TARGETS_FILE, guidanceTargets);

// Print summary
const ifaceCount = Object.keys(spec.interfaces).length;
let methodCount = 0;
for (const [name, iface] of Object.entries(spec.interfaces)) {
  const count = Object.keys(iface.functions).length;
  methodCount += count;
  console.log(`  ${name}: ${count} methods`);
}
const typeCount = Object.keys(spec.types).length;

console.log(`\nSub-APIs discovered:`);
console.log(
  `  workbook: ${Object.keys(spec.subApis.workbook).length} (${Object.keys(spec.subApis.workbook).join(', ')})`,
);
console.log(
  `  worksheet: ${Object.keys(spec.subApis.worksheet).length} (${Object.keys(spec.subApis.worksheet).join(', ')})`,
);
console.log(`\nTotal: ${ifaceCount} interfaces, ${methodCount} methods, ${typeCount} types`);
