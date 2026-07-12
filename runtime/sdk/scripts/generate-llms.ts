/**
 * Refresh and validate the generated contract section in runtime/sdk/llms.txt.
 *
 * The surrounding document is intentionally curated for concise agent guidance.
 * API signatures, semantic field documentation, and format keys come from the
 * installed-version API spec so they cannot drift independently.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

interface FunctionEntry {
  canonicalPath?: string;
  signature: string;
  docstring: string;
}

interface InterfaceEntry {
  members: Record<string, FunctionEntry>;
  functions: Record<string, FunctionEntry>;
}

interface TypeEntry {
  definition?: string;
  docstring?: string;
}

interface ApiSpec {
  interfaces: Record<string, InterfaceEntry>;
  types: Record<string, TypeEntry>;
}

interface TypeProperty {
  name: string;
  optional: boolean;
  declaration: string;
  docstring: string;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(SCRIPT_DIR, '..');
const API_SPEC_PATH = path.join(SDK_DIR, 'src/generated/api-spec.json');
const LLMS_PATH = path.join(SDK_DIR, 'llms.txt');
const GENERATED_START = '<!-- BEGIN GENERATED:API-CONTRACTS -->';
const GENERATED_END = '<!-- END GENERATED:API-CONTRACTS -->';
const A1_PATHS = new Set([
  'a1.address',
  'a1.range',
  'a1.column',
  'a1.columnIndex',
  'a1.offset',
  'a1.parse',
  'a1.rangeAddress',
  'a1.columnName',
  'a1.parseAddress',
]);

function fail(message: string): never {
  throw new Error(`llms.txt contract error: ${message}`);
}

function readSpec(): ApiSpec {
  return JSON.parse(fs.readFileSync(API_SPEC_PATH, 'utf8')) as ApiSpec;
}

function methodIndex(spec: ApiSpec): Map<string, FunctionEntry> {
  const methods = new Map<string, FunctionEntry>();
  for (const iface of Object.values(spec.interfaces)) {
    for (const entry of Object.values(iface.members ?? iface.functions)) {
      if (entry.canonicalPath) methods.set(entry.canonicalPath, entry);
    }
  }
  return methods;
}

function requireMethod(methods: Map<string, FunctionEntry>, pathName: string): FunctionEntry {
  const entry = methods.get(pathName);
  if (!entry) fail(`missing public API path ${pathName}`);
  return entry;
}

function requireType(spec: ApiSpec, name: string): TypeEntry & { definition: string } {
  const entry = spec.types[name];
  if (!entry?.definition) fail(`missing generated type definition ${name}`);
  return entry as TypeEntry & { definition: string };
}

function cleanDocLine(line: string): string {
  return line
    .trim()
    .replace(/^\/\*\*?\s?/, '')
    .replace(/^\*\s?/, '')
    .replace(/\s?\*\/$/, '')
    .trim();
}

function parseTypeProperties(definition: string): TypeProperty[] {
  const lines = definition.split('\n');
  const properties: TypeProperty[] = [];
  let pendingDoc: string[] = [];
  let inDoc = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('/**')) {
      inDoc = !trimmed.endsWith('*/');
      const cleaned = cleanDocLine(trimmed);
      if (cleaned) pendingDoc.push(cleaned);
      continue;
    }
    if (inDoc) {
      const cleaned = cleanDocLine(trimmed);
      if (cleaned) pendingDoc.push(cleaned);
      if (trimmed.endsWith('*/')) inDoc = false;
      continue;
    }

    const property = line.match(/^  ([A-Za-z_$][\w$]*)(\?)?:\s*(.*)$/);
    if (!property) continue;

    const declarationLines = [trimmed];
    while (!declarationLines.at(-1)?.endsWith(';') && index + 1 < lines.length) {
      index += 1;
      declarationLines.push((lines[index] ?? '').trim());
    }
    properties.push({
      name: property[1],
      optional: property[2] === '?',
      declaration: declarationLines.join(' '),
      docstring: pendingDoc.join(' ').replace(/\s+/g, ' ').trim(),
    });
    pendingDoc = [];
  }

  return properties;
}

function requireProperty(properties: TypeProperty[], name: string): TypeProperty {
  const property = properties.find((entry) => entry.name === name);
  if (!property) fail(`missing generated type property ${name}`);
  return property;
}

function writeAliasTarget(property: TypeProperty): string | null {
  return property.docstring.match(/write-only alias for `([^`]+)`/i)?.[1] ?? null;
}

function renderGeneratedContracts(spec: ApiSpec): string {
  const methods = methodIndex(spec);
  const layout = requireMethod(methods, 'ws.layout.setColumnWidth');
  const chartAdd = requireMethod(methods, 'ws.charts.add');
  const chartProperties = parseTypeProperties(requireType(spec, 'ChartConfig').definition);
  const cellFormatProperties = parseTypeProperties(requireType(spec, 'CellFormat').definition);
  const cellFormatInputProperties = parseTypeProperties(
    requireType(spec, 'CellFormatInput').definition,
  );
  const tableOptions = parseTypeProperties(requireType(spec, 'TableOptions').definition);
  const tableName = requireProperty(tableOptions, 'name');
  const chartFields = ['anchorRow', 'anchorCol', 'width', 'height'].map((name) =>
    requireProperty(chartProperties, name),
  );
  const compatibilityInputs = cellFormatInputProperties.filter(
    (property) => !cellFormatProperties.some((flat) => flat.name === property.name),
  );
  const compatibilityAliases = compatibilityInputs.flatMap((property) => {
    const target = writeAliasTarget(property);
    return target ? [{ property, target }] : [];
  });
  const compatibilityContainers = compatibilityInputs.filter(
    (property) => writeAliasTarget(property) === null,
  );

  if (!layout.docstring) fail('ws.layout.setColumnWidth must document selectors and units');
  for (const field of chartFields) {
    if (!field.docstring) fail(`ChartConfig.${field.name} must document indexing or units`);
  }
  if (!tableName.docstring.toLowerCase().includes('cell reference')) {
    fail('TableOptions.name must document the cell-reference restriction');
  }
  if (cellFormatProperties.length === 0) fail('CellFormat must expose canonical flat keys');

  const lines = [
    GENERATED_START,
    '',
    '### Layout selectors and units',
    '',
    '```typescript',
    layout.signature,
    '```',
    '',
    layout.docstring,
    '',
    '### Chart placement and units',
    '',
    '```typescript',
    chartAdd.signature,
    '```',
    '',
    ...chartFields.map(
      (field) => `- \`${field.declaration}\` — ${field.docstring.replace(/\.$/, '')}.`,
    ),
    '',
    'A complete minimal chart call is:',
    '',
    '```typescript',
    'await ws.charts.add({',
    "  type: 'bar',",
    "  dataRange: 'A1:B5',",
    '  anchorRow: 0,',
    '  anchorCol: 3,',
    '  width: 480,',
    '  height: 288,',
    '});',
    '```',
    '',
    '### Cell formatting keys',
    '',
    'Canonical flat `CellFormat` keys:',
    '',
    cellFormatProperties.map((property) => `\`${property.name}\``).join(', '),
    '',
    ...(compatibilityAliases.length > 0
      ? [
          `\`CellFormatInput\` also accepts write-only compatibility aliases: ${compatibilityAliases
            .map(({ property, target }) => `\`${property.name}\` → \`${target}\``)
            .join(
              ', ',
            )}. Aliases are normalized before persistence; format reads expose only the canonical keys.`,
          '',
        ]
      : []),
    ...(compatibilityContainers.length > 0
      ? [
          `\`CellFormatInput\` also accepts compatibility containers: ${compatibilityContainers
            .map((property) => `\`${property.name}\``)
            .join(', ')}. Prefer the flat keys for Mog-native code.`,
          '',
        ]
      : []),
    "Inspect `api.describe('type:CellFormatInput')` before generating format objects; do not invent keys.",
    '',
    '### Table names',
    '',
    `\`TableOptions.name\`: ${tableName.docstring}`,
    '',
    GENERATED_END,
  ];
  return lines.join('\n');
}

function replaceGeneratedContracts(content: string, generated: string): string {
  const start = content.indexOf(GENERATED_START);
  const end = content.indexOf(GENERATED_END);
  if (start < 0 || end < start) fail('missing generated API contract markers');
  const afterEnd = end + GENERATED_END.length;
  return `${content.slice(0, start)}${generated}${content.slice(afterEnd)}`;
}

function validateReferences(content: string, spec: ApiSpec): void {
  const methods = methodIndex(spec);
  const references = new Set(
    [...content.matchAll(/\b(?:wb|ws|a1)\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)].map(
      (match) => match[0],
    ),
  );
  for (const reference of references) {
    if (reference.endsWith('.methods') && methods.has(reference.slice(0, -'.methods'.length))) {
      continue;
    }
    if (!methods.has(reference) && !A1_PATHS.has(reference)) {
      fail(`documented API path does not exist in the generated spec: ${reference}`);
    }
  }

  const describePaths = [...content.matchAll(/api\.describe\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1],
  );
  for (const pathName of describePaths) {
    if (pathName === 'wb' || pathName === 'ws' || pathName === 'a1') continue;
    if (pathName.startsWith('type:')) {
      requireType(spec, pathName.slice(5));
    } else if (!methods.has(pathName) && !A1_PATHS.has(pathName)) {
      fail(`api.describe path does not exist in the generated spec: ${pathName}`);
    }
  }
}

function main(): void {
  const check = argv.includes('--check');
  const spec = readSpec();
  const current = fs.readFileSync(LLMS_PATH, 'utf8');
  const expected = replaceGeneratedContracts(current, renderGeneratedContracts(spec));
  validateReferences(expected, spec);

  if (check) {
    if (expected !== current) {
      fail('generated API contract section is stale; run pnpm generate:llms');
    }
    console.log(`Verified: ${LLMS_PATH}`);
    return;
  }

  if (expected === current) {
    console.log(`Unchanged: ${LLMS_PATH}`);
    return;
  }
  fs.writeFileSync(LLMS_PATH, expected);
  console.log(`Written: ${LLMS_PATH}`);
}

main();
