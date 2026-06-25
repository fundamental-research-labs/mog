/**
 * API Reference Generator for Unified Spreadsheet API
 *
 * Generates API reference JSON from the unified contract interfaces in
 * `types/api/src/api/`. Reads root Workbook/Worksheet interfaces and all
 * namespaced sub-API interfaces (e.g., WorksheetCharts, WorkbookSheets).
 *
 * Sub-API methods are represented with dotted names (e.g., "charts.add")
 * so consumers see the full call path: `ws.charts.add(config)`.
 *
 * Usage:
 *   pnpm generate:api-ref
 *
 * Output:
 *   docs/generated/api-reference.json
 *
 * Downstream consumers (backend agent, client) can copy or symlink this file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { InterfaceDeclaration, JSDoc, MethodSignature, Project, Type } from 'ts-morph';
import { FORMAT_PRESETS, DEFAULT_FORMAT_BY_TYPE } from '../contracts/src/number-formats/constants';

// ============================================================================
// Types
// ============================================================================

interface ApiFunction {
  signature: string;
  docstring: string | null;
  usedTypes: string[];
  tags?: string[];
}

interface ApiInterface {
  functions: Record<string, ApiFunction>;
  docstring?: string | null;
  tags?: string[];
}

interface ApiReference {
  interfaces: Record<string, ApiInterface>;
  types?: Record<string, TypeDefinition>;
  formatPresets?: Record<
    string,
    Record<string, { code: string; example: string; description?: string }>
  >;
  defaultFormats?: Record<string, string>;
  generated: string;
}

interface TypeDefinition {
  name: string;
  definition?: string;
  isEnum?: boolean;
  values?: Record<string, string | number>;
  docstring?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const scriptDir = __dirname;
const rootDir = path.join(scriptDir, '..');

// Unified API contract sources. `contracts/src/api` is now a package re-export
// shim; read the source package so ts-morph sees the actual interfaces.
const API_DIR = path.join(rootDir, 'types/api/src/api');
const TYPES_FILE = path.join(API_DIR, 'types.ts');
const WORKBOOK_FILE = path.join(API_DIR, 'workbook.ts');
const WORKSHEET_FILE = path.join(API_DIR, 'worksheet.ts');
const WORKSHEET_SUB_DIR = path.join(API_DIR, 'worksheet');
const WORKBOOK_SUB_DIR = path.join(API_DIR, 'workbook');

// Core type sources (CellFormat, CellBorders, etc. live here, not in api/)
const CORE_TYPES_FILE = path.join(rootDir, 'types/core/src/core.ts');

// Root interfaces to extract
const ROOT_INTERFACES = ['Workbook', 'Worksheet'];

// Sub-API namespace mapping: interface name → namespace accessor on parent
// Worksheet sub-APIs
const WORKSHEET_SUB_APIS: Record<string, string> = {
  WorksheetFormats: 'formats',
  WorksheetLayout: 'layout',
  WorksheetView: 'view',
  WorksheetStructure: 'structure',
  WorksheetCharts: 'charts',
  WorksheetObjectCollection: 'objects',
  WorksheetFilters: 'filters',
  WorksheetConditionalFormatting: 'conditionalFormats',
  WorksheetValidation: 'validation',
  WorksheetTables: 'tables',
  WorksheetPivots: 'pivots',
  WorksheetSlicers: 'slicers',
  WorksheetSparklines: 'sparklines',
  WorksheetComments: 'comments',
  WorksheetHyperlinks: 'hyperlinks',
  WorksheetOutline: 'outline',
  WorksheetProtection: 'protection',
  WorksheetPrint: 'print',
  WorksheetSettings: 'settings',
  WorksheetBindings: 'bindings',
  WorksheetDiagrams: 'diagrams',
  WorksheetNames: 'names',
  WorksheetFormControls: 'formControls',
};

// Workbook sub-APIs
const WORKBOOK_SUB_APIS: Record<string, string> = {
  WorkbookSheets: 'sheets',
  WorkbookNames: 'names',
  WorkbookScenarios: 'scenarios',
  WorkbookHistory: 'history',
  WorkbookTableStyles: 'tableStyles',
  WorkbookCellStyles: 'cellStyles',
  WorkbookProtection: 'protection',
  WorkbookNotifications: 'notifications',
  WorkbookTheme: 'theme',
  WorkbookSlicers: 'slicers',
  WorkbookVersion: 'version',
  WorkbookViewport: 'viewport',
};

// Types that are part of the external API surface
const EXTERNAL_API_TYPES = [
  // Enums
  'NumberFormatType',
  'LineStyle',
  'HorizontalAlign',
  'VerticalAlign',
  'DataValidationType',
  'DataValidationOperator',
  'DataValidationErrorStyle',
  // Type aliases
  'ChartType',
  'ConditionalFormattingStyle',
  // Cell formatting
  'CellFormat',
  'CellBorders',
  'BorderStyle',
  'PatternType',
  'GradientFill',
  // Interfaces
  'LineBorder',
  'Style',
  'Chart',
  'Table',
  'ChartConfig',
  'ChartProperties',
  'ConditionalFormattingOptions',
  'DataValidationOptions',
  'PivotTableConfig',
  'PivotTableHandle',
  'CellData',
  'RawCellData',
  'CellWriteOptions',
  'SummaryOptions',
  'SortOptions',
  'SortColumn',
  'MergedRegion',
  'GoalSeekResult',
  'CFRule',
  'ValidationRule',
  'FilterCriteria',
  'FilterCondition',
  'FilterState',
  'TableOptions',
  'TableInfo',
  'NamedRangeInfo',
  'SearchOptions',
  'SearchResult',
  'ViewOptions',
  'ProtectionConfig',
  'ProtectionOptions',
  'AggregateResult',
  'FilterInfo',
  'TextToColumnsOptions',
  'RemoveDuplicatesResult',
  'TableStyleInfo',
  'TableStyleConfig',
  'WorkbookSettings',
  'FloatingObjectInfo',
  'PictureConfig',
  'TextBoxConfig',
  'EquationConfig',
  'EquationUpdates',
  'TextEffectConfig',
  'TextEffectUpdates',
  'DiagramConfig',
  'DiagramHandle',
  'SlicerConfig',
  'SlicerInfo',
  'SlicerState',
  'SlicerItem',
  'SparklineConfig',
  'SparklineGroupConfig',
];

// Built-in types that don't need definitions
const BUILT_IN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'void',
  'never',
  'any',
  'unknown',
  'Array',
  'Promise',
  'Record',
  'Map',
  'Set',
  'Date',
  'Error',
  'RegExp',
  'Partial',
]);

// Methods/properties to skip (internal plumbing, not for external consumers)
const SKIP_METHODS = new Set([
  // Internal plumbing on Workbook
  'setPendingUndoDescription',
  'setPendingSelectionCheckpoint',
  'createCalculatorContext',
  'recalculateAll',
  'recalculateSheet',
  'emit',
  // Internal plumbing on Worksheet
  'setCells',
]);

// ============================================================================
// JSDoc Extraction
// ============================================================================

function getJsDocComment(node: { getJsDocs(): JSDoc[] }): string | null {
  const jsDocs = node.getJsDocs();
  if (jsDocs.length === 0) return null;

  const doc = jsDocs[0];
  const description = doc.getDescription().trim();

  const tags = doc.getTags();
  const parts = [description];

  for (const tag of tags) {
    const tagName = tag.getTagName();
    if (tagName === 'tags') continue; // Skip @tags annotations
    const text = tag.getCommentText()?.trim();
    if (text) {
      parts.push(`@${tagName} ${text}`);
    }
  }

  return parts.filter(Boolean).join('\n') || null;
}

function extractTags(node: { getJsDocs(): JSDoc[] }): string[] | undefined {
  const jsDocs = node.getJsDocs();
  if (jsDocs.length === 0) return undefined;

  const doc = jsDocs[0];
  for (const tag of doc.getTags()) {
    if (tag.getTagName() === 'tags') {
      const text = tag.getCommentText()?.trim();
      if (text) {
        return text
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
  }
  return undefined;
}

// ============================================================================
// Type Extraction
// ============================================================================

function extractUsedTypesFromMethods(
  methods: readonly MethodSignature[],
  knownTypes: Set<string>,
): string[] {
  const used: Set<string> = new Set();

  const extractFromType = (type: Type) => {
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (symbol) {
      const name = symbol.getName();
      if (knownTypes.has(name) && !BUILT_IN_TYPES.has(name)) {
        used.add(name);
      }
    }
    for (const arg of type.getTypeArguments()) {
      extractFromType(arg);
    }
    if (type.isUnion()) {
      for (const unionType of type.getUnionTypes()) {
        extractFromType(unionType);
      }
    }
  };

  for (const method of methods) {
    for (const param of method.getParameters()) {
      extractFromType(param.getType());
    }
    extractFromType(method.getReturnType());
  }

  return Array.from(used).sort();
}

// ============================================================================
// Signature Formatting
// ============================================================================

function formatSignature(method: MethodSignature, prefix?: string): string {
  const name = prefix ? `${prefix}.${method.getName()}` : method.getName();
  const params = method
    .getParameters()
    .map((p) => {
      const optional = p.isOptional() ? '?' : '';
      let typeText = p.getType().getText();
      typeText = typeText.replace(/import\([^)]+\)\./g, '');
      return `${p.getName()}${optional}: ${typeText}`;
    })
    .join(', ');

  let returnType = method.getReturnType().getText();
  returnType = returnType.replace(/import\([^)]+\)\./g, '');

  return `${name}(${params}): ${returnType}`;
}

function methodsByName(iface: InterfaceDeclaration): Map<string, MethodSignature[]> {
  const groups = new Map<string, MethodSignature[]>();
  for (const method of iface.getMethods()) {
    const name = method.getName();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(method);
  }
  return groups;
}

function pickApiReferenceMethod(
  interfaceName: string,
  methodName: string,
  methods: readonly MethodSignature[],
): MethodSignature {
  if (methods.length === 0) {
    throw new Error('Cannot choose a method from an empty overload set.');
  }
  if (methods.length === 1) return methods[0]!;
  if (!usesBroadPublicRefOverload(interfaceName, methodName)) return methods[0]!;

  return methods.reduce((best, candidate) =>
    methodGeneralityScore(candidate) > methodGeneralityScore(best) ? candidate : best,
  );
}

function usesBroadPublicRefOverload(interfaceName: string, methodName: string): boolean {
  return (
    interfaceName === 'WorkbookVersion' && (methodName === 'readRef' || methodName === 'getRef')
  );
}

function methodGeneralityScore(method: MethodSignature): number {
  let score = method.getTypeParameters().length > 0 ? 0 : 100;
  for (const parameter of method.getParameters()) {
    const typeText = parameter.getTypeNode()?.getText() ?? parameter.getType().getText();
    score += parameterTypeGeneralityScore(typeText);
  }
  return score;
}

function parameterTypeGeneralityScore(typeText: string): number {
  const compact = typeText
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\]<>,:;|&=])\s*/g, '$1')
    .trim();
  if (!compact) return 0;
  if (/^(['"`]).*\1$/.test(compact)) return 1;

  let score = Math.min(compact.length, 80);
  if (compact === 'string' || compact === 'unknown') score += 80;
  if (compact.includes('VersionRefSelector')) score += 80;
  if (compact.includes('VersionCommitish')) score += 80;
  if (compact.includes('|')) score += 20 + compact.split('|').length * 10;
  if (compact.includes('{') || compact.includes('Record<')) score += 20;
  return score;
}

// ============================================================================
// Interface Extraction
// ============================================================================

function extractRootInterface(iface: InterfaceDeclaration, knownTypes: Set<string>): ApiInterface {
  const spec: ApiInterface = {
    docstring: getJsDocComment(iface),
    functions: {},
  };

  // Extract readonly properties (e.g. `readonly activeSheet: Worksheet`)
  for (const prop of iface.getProperties()) {
    const name = prop.getName();
    if (name.startsWith('_') || SKIP_METHODS.has(name)) continue;

    let typeText = prop.getType().getText();
    typeText = typeText.replace(/import\([^)]+\)\./g, '');
    const readonly = prop.isReadonly() ? 'readonly ' : '';
    const optional = prop.hasQuestionToken() ? '?' : '';
    const signature = `${readonly}${name}${optional}: ${typeText};`;

    const usedTypes: string[] = [];
    const symbol = prop.getType().getSymbol() ?? prop.getType().getAliasSymbol();
    if (symbol && knownTypes.has(symbol.getName()) && !BUILT_IN_TYPES.has(symbol.getName())) {
      usedTypes.push(symbol.getName());
    }

    const tags = extractTags(prop);
    spec.functions[name] = {
      signature,
      docstring: getJsDocComment(prop),
      usedTypes,
      ...(tags && { tags }),
    };
  }

  for (const [name, overloads] of methodsByName(iface)) {
    if (name.startsWith('_') || SKIP_METHODS.has(name)) continue;

    if (spec.functions[name]) continue;

    const method = pickApiReferenceMethod(iface.getName(), name, overloads);
    const usedTypeMethods = usesBroadPublicRefOverload(iface.getName(), name)
      ? overloads
      : [method];
    const tags = extractTags(method);
    spec.functions[name] = {
      signature: formatSignature(method),
      docstring: getJsDocComment(method),
      usedTypes: extractUsedTypesFromMethods(usedTypeMethods, knownTypes),
      ...(tags && { tags }),
    };
  }

  return spec;
}

function extractSubApiMethods(
  iface: InterfaceDeclaration,
  namespace: string,
  knownTypes: Set<string>,
): Record<string, ApiFunction> {
  const functions: Record<string, ApiFunction> = {};

  for (const [methodName, overloads] of methodsByName(iface)) {
    if (methodName.startsWith('_')) continue;

    const dottedName = `${namespace}.${methodName}`;

    if (functions[dottedName]) continue;

    const method = pickApiReferenceMethod(iface.getName(), methodName, overloads);
    const usedTypeMethods = usesBroadPublicRefOverload(iface.getName(), methodName)
      ? overloads
      : [method];
    const tags = extractTags(method);
    functions[dottedName] = {
      signature: formatSignature(method, namespace),
      docstring: getJsDocComment(method),
      usedTypes: extractUsedTypesFromMethods(usedTypeMethods, knownTypes),
      ...(tags && { tags }),
    };
  }

  return functions;
}

// ============================================================================
// Type Definition Extraction
// ============================================================================

function extractType(typeName: string, project: Project): TypeDefinition | null {
  for (const sourceFile of project.getSourceFiles()) {
    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (typeAlias) {
      let definition = typeAlias.getTypeNode()?.getText() ?? typeAlias.getType().getText();
      definition = definition.replace(/import\([^)]+\)\./g, '');
      return {
        name: typeName,
        definition,
        docstring: getJsDocComment(typeAlias) ?? undefined,
      };
    }

    const enumDecl = sourceFile.getEnum(typeName);
    if (enumDecl) {
      const values: Record<string, string | number> = {};
      for (const member of enumDecl.getMembers()) {
        const value = member.getValue();
        values[member.getName()] = value ?? member.getName();
      }
      return {
        name: typeName,
        isEnum: true,
        values,
        docstring: getJsDocComment(enumDecl) ?? undefined,
      };
    }

    const ifaceDecl = sourceFile.getInterface(typeName);
    if (ifaceDecl) {
      const parts: string[] = [];

      for (const prop of ifaceDecl.getProperties()) {
        const optional = prop.hasQuestionToken() ? '?' : '';
        let typeText = prop.getType().getText();
        typeText = typeText.replace(/import\([^)]+\)\./g, '');
        const propDoc = getJsDocComment(prop);
        if (propDoc) {
          parts.push(`  /** ${propDoc} */`);
        }
        parts.push(`  ${prop.getName()}${optional}: ${typeText};`);
      }

      for (const method of ifaceDecl.getMethods()) {
        const methodDoc = getJsDocComment(method);
        if (methodDoc) {
          parts.push(`  /** ${methodDoc} */`);
        }
        parts.push(`  ${formatSignature(method)};`);
      }

      return {
        name: typeName,
        definition: `{\n${parts.join('\n')}\n}`,
        docstring: getJsDocComment(ifaceDecl) ?? undefined,
      };
    }
  }

  return null;
}

// ============================================================================
// Main Generator
// ============================================================================

function generate(): ApiReference {
  const project = new Project({
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
      moduleResolution: 100, // Bundler
      strict: true,
      skipLibCheck: true,
    },
  });

  const knownTypes = new Set(EXTERNAL_API_TYPES);
  const spec: ApiReference = {
    interfaces: {},
    types: {},
    generated: new Date().toISOString(),
  };

  // Add all API source files
  // Add all API source files (including core for CellFormat, CellBorders, etc.)
  const apiFiles = [TYPES_FILE, WORKBOOK_FILE, WORKSHEET_FILE, CORE_TYPES_FILE];

  // Add sub-API interface files
  if (fs.existsSync(WORKSHEET_SUB_DIR)) {
    for (const file of fs.readdirSync(WORKSHEET_SUB_DIR)) {
      if (file.endsWith('.ts') && file !== 'index.ts') {
        apiFiles.push(path.join(WORKSHEET_SUB_DIR, file));
      }
    }
  }
  if (fs.existsSync(WORKBOOK_SUB_DIR)) {
    for (const file of fs.readdirSync(WORKBOOK_SUB_DIR)) {
      if (file.endsWith('.ts') && file !== 'index.ts') {
        apiFiles.push(path.join(WORKBOOK_SUB_DIR, file));
      }
    }
  }

  for (const sourcePath of apiFiles) {
    if (fs.existsSync(sourcePath)) {
      project.addSourceFileAtPath(sourcePath);
    } else {
      console.warn(`Warning: Source file not found: ${sourcePath}`);
    }
  }

  // Build a map of all sub-API interfaces for lookup
  const allSubApis: Map<
    string,
    { iface: InterfaceDeclaration; namespace: string; parent: 'Workbook' | 'Worksheet' }
  > = new Map();

  for (const sourceFile of project.getSourceFiles()) {
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      if (WORKSHEET_SUB_APIS[name]) {
        allSubApis.set(name, { iface, namespace: WORKSHEET_SUB_APIS[name], parent: 'Worksheet' });
      } else if (WORKBOOK_SUB_APIS[name]) {
        allSubApis.set(name, { iface, namespace: WORKBOOK_SUB_APIS[name], parent: 'Workbook' });
      }
    }
  }

  // Extract root interfaces
  for (const sourceFile of project.getSourceFiles()) {
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      if (ROOT_INTERFACES.includes(name)) {
        spec.interfaces[name] = extractRootInterface(iface, knownTypes);
      }
    }
  }

  // Merge sub-API methods into parent interfaces with dotted names
  for (const [_ifaceName, { iface, namespace, parent }] of allSubApis) {
    const parentSpec = spec.interfaces[parent];
    if (!parentSpec) continue;

    const subMethods = extractSubApiMethods(iface, namespace, knownTypes);
    Object.assign(parentSpec.functions, subMethods);
  }

  // Extract types
  for (const typeName of EXTERNAL_API_TYPES) {
    const typeSpec = extractType(typeName, project);
    if (typeSpec) {
      spec.types![typeName] = typeSpec;
    }
  }

  // Add format presets for agent discoverability
  spec.formatPresets = FORMAT_PRESETS as any;
  spec.defaultFormats = DEFAULT_FORMAT_BY_TYPE;

  return spec;
}

// ============================================================================
// Main
// ============================================================================

console.log('Generating Unified API reference from types/api/src/api/...');

const spec = generate();

// Output path
const outputPath = path.join(rootDir, 'docs/generated/api-reference.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`  Written: ${outputPath}`);

// Count methods
let totalMethods = 0;
for (const [name, iface] of Object.entries(spec.interfaces)) {
  const methodCount = Object.keys(iface.functions).length;
  totalMethods += methodCount;
  const rootMethods = Object.keys(iface.functions).filter((n) => !n.includes('.')).length;
  const subMethods = methodCount - rootMethods;
  console.log(`  ${name}: ${rootMethods} root + ${subMethods} namespaced = ${methodCount} total`);
}

console.log(`\nTotal methods: ${totalMethods}`);
console.log(`Types: ${Object.keys(spec.types!).length}`);
console.log('\nDone!');
