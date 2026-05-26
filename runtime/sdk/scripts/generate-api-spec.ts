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
 * Output: runtime/sdk/src/generated/api-spec.json
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

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CONTRACTS_API_DIR = path.resolve(REPO_ROOT, 'contracts/src/api');
const CONTRACTS_SRC_DIR = path.resolve(REPO_ROOT, 'contracts/src');
// Post contracts-dag, most API type definitions live in `types/*/src` (see
// the contracts/type package split). We scan both roots for
// type references — contracts/ hosts the interfaces while types/ hosts the
// data shapes they reference (ChartConfig, AxisConfig, …).
const TYPES_SRC_DIR = path.resolve(REPO_ROOT, 'types');
const TYPES_API_DIR = path.resolve(REPO_ROOT, 'types/api/src/api');
const OUTPUT_FILE = path.resolve(REPO_ROOT, 'runtime/sdk/src/generated/api-spec.json');

// ---------------------------------------------------------------------------
// Exclude lists (OK to hand-maintain — these hide internal plumbing)
// ---------------------------------------------------------------------------

const WORKBOOK_EXCLUDED_MEMBERS = new Set([
  'activeSheet',
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

interface FunctionEntry {
  signature: string;
  docstring: string;
  usedTypes: string[];
}

interface InterfaceEntry {
  docstring: string;
  functions: Record<string, FunctionEntry>;
}

interface TypeEntry {
  name: string;
  definition?: string;
  isEnum?: boolean;
  values?: Record<string, string>;
  docstring?: string;
}

interface SubApiMap {
  [accessor: string]: string; // accessor name -> interface name
}

interface ApiSpec {
  subApis: {
    wb: SubApiMap;
    ws: SubApiMap;
  };
  interfaces: Record<string, InterfaceEntry>;
  types: Record<string, TypeEntry>;
  formatPresets?: Record<
    string,
    Record<string, { code: string; example: string; description?: string }>
  >;
  defaultFormats?: Record<string, string>;
  generated: string;
}

// ---------------------------------------------------------------------------
// Step 1: Parse root interfaces and auto-discover sub-APIs
// ---------------------------------------------------------------------------

interface SubApiInfo {
  accessor: string; // e.g. "charts"
  interfaceName: string; // e.g. "WorksheetCharts"
  parent: 'wb' | 'ws';
}

/**
 * Scan a root interface for readonly property signatures whose type
 * references another interface (PascalCase name starting with Workbook/Worksheet).
 * These are the sub-API accessors.
 */
function discoverSubApis(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  parent: 'wb' | 'ws',
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

    results.push({ accessor: name, interfaceName, parent });
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
): InterfaceEntry {
  const docstring = getJSDocText(node);
  const functions: Record<string, FunctionEntry> = {};

  const byName = new Map<string, ts.TypeElement[]>();
  for (const member of node.members) {
    const name = (member as any).name?.getText(sourceFile) ?? '';
    if (!name || excludedMembers.has(name)) continue;

    // Skip readonly property signatures (sub-API accessors) — they're not methods
    if (ts.isPropertySignature(member)) {
      const isReadonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
      if (isReadonly) continue;
    }

    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(member);
  }

  for (const [name, members] of byName) {
    const chosen = pickOverload(members, sourceFile);
    const signature = getSignatureText(chosen, sourceFile);
    const doc = getJSDocText(chosen);

    const usedTypes = collectTypeRefs(signature);

    functions[name] = { signature, docstring: doc, usedTypes };
  }

  return { docstring, functions };
}

function extractSubApiInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
): InterfaceEntry {
  return extractInterface(node, sourceFile, new Set());
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
    ...collectDirectories(CONTRACTS_API_DIR),
    ...collectDirectories(TYPES_API_DIR),
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
        const values: Record<string, string> = {};
        for (const member of node.members) {
          const memberName = member.name.getText(sourceFile);
          const value =
            member.initializer?.getText(sourceFile) ?? String(Object.keys(values).length);
          values[memberName] = value;
        }
        result[name] = { name, isEnum: true, values, docstring };
      }

      // --- Type alias declarations ---
      else if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        if (!remaining.has(name)) return;
        remaining.delete(name);

        const docstring = getJSDocText(node);
        const definition = node.type.getText(sourceFile);
        result[name] = { name, definition, docstring };
      }

      // --- Interface declarations (data shape interfaces) ---
      else if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        if (!remaining.has(name)) return;
        remaining.delete(name);

        const docstring = getJSDocText(node);
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
  const workbookFile = path.join(CONTRACTS_API_DIR, 'workbook.ts');
  const worksheetFile = path.join(CONTRACTS_API_DIR, 'worksheet.ts');

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

  const subApiMap: ApiSpec['subApis'] = { wb: {}, ws: {} };
  for (const sa of allSubApis) {
    subApiMap[sa.parent][sa.accessor] = sa.interfaceName;
  }

  // --- Step 2: Extract root interface methods (excluding sub-API properties) ---
  const interfaces: Record<string, InterfaceEntry> = {};

  interfaces['Workbook'] = extractInterface(
    wbParsed.node,
    wbParsed.sourceFile,
    WORKBOOK_EXCLUDED_MEMBERS,
  );
  interfaces['Worksheet'] = extractInterface(
    wsParsed.node,
    wsParsed.sourceFile,
    WORKSHEET_EXCLUDED_MEMBERS,
  );

  // --- Step 3: Find and parse sub-API interfaces ---
  for (const sa of allSubApis) {
    const filePath = findInterfaceFile(sa.interfaceName);
    if (!filePath) {
      console.warn(`[warn] Could not find file for interface: ${sa.interfaceName}`);
      continue;
    }

    const parsed = parseInterfaceFromFile(filePath, sa.interfaceName);
    if (!parsed) {
      console.warn(`[warn] Could not parse interface ${sa.interfaceName} from ${filePath}`);
      continue;
    }

    interfaces[sa.interfaceName] = extractSubApiInterface(parsed.node, parsed.sourceFile);
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

  return {
    subApis: subApiMap,
    interfaces,
    types: sortedTypes,
    formatPresets: FORMAT_PRESETS as any,
    defaultFormats: DEFAULT_FORMAT_BY_TYPE,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating SDK API spec from contracts/src/api/...\n');

const spec = generate();

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

// Only write if content actually changed (avoids noisy diffs on publish)
const newContent = JSON.stringify(spec, null, 2) + '\n';
const existingContent = fs.existsSync(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, 'utf-8') : '';
if (newContent === existingContent) {
  console.log(`Unchanged: ${OUTPUT_FILE}\n`);
} else {
  fs.writeFileSync(OUTPUT_FILE, newContent);
  console.log(`Written: ${OUTPUT_FILE}\n`);
}

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
  `  wb: ${Object.keys(spec.subApis.wb).length} (${Object.keys(spec.subApis.wb).join(', ')})`,
);
console.log(
  `  ws: ${Object.keys(spec.subApis.ws).length} (${Object.keys(spec.subApis.ws).join(', ')})`,
);
console.log(`\nTotal: ${ifaceCount} interfaces, ${methodCount} methods, ${typeCount} types`);
