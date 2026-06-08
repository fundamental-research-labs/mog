/**
 * Post-process api-extractor DTS output — validation gate.
 *
 * api-extractor keeps public @mog-sdk/* package imports and inlines private
 * @mog/* / @mog-sdk/types-* imports. This script validates that NO private
 * workspace imports remain.
 *
 * If an internal import leaks, the build fails loudly.
 */
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = resolve(__dirname, '..');
const DIST = resolve(SDK_ROOT, 'dist');

const PUBLIC_DECLARATIONS = new Set([
  'index.d.ts',
  'index.d.cts',
  'wasm.d.ts',
  'workerd.d.ts',
  'api-compatibility/index.d.ts',
  'api-compatibility/registry.d.ts',
  'api-compatibility/types.d.ts',
  'api-describe.d.ts',
  'agent-guidance/analyze.d.ts',
  'agent-guidance/catalog.d.ts',
  'agent-guidance/explain.d.ts',
  'agent-guidance/index.d.ts',
  'agent-guidance/targets.d.ts',
  'agent-guidance/types.d.ts',
  'boot.d.ts',
  'collaborative-engine.d.ts',
  'public-kernel-facade.d.ts',
]);

// Internal workspace packages that must NOT appear in published .d.ts.
// api-extractor inlines all of these — any remaining import is a build failure.
const INTERNAL_PATTERNS = [
  // Static imports/exports: retired contracts package.
  /from ['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]/,
  // Static imports/exports: private @mog-sdk/types-* packages.
  /from ['"]@mog-sdk\/types-[^'"]*['"]/,
  // Static imports/exports: from '@mog/...'
  /from ['"]@mog\/[^'"]*['"]/,
  // Static imports/exports: from '@rust-bridge/...'
  /from ['"]@rust-bridge\/[^'"]*['"]/,
  // Dynamic import() type expressions: retired contracts package.
  /import\(\s*['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]\s*\)/,
  // Dynamic import() type expressions: private @mog-sdk/types-* packages.
  /import\(\s*['"]@mog-sdk\/types-[^'"]*['"]\s*\)/,
  // Dynamic import() type expressions: import('@mog/...')
  /import\(\s*['"]@mog\/[^'"]*['"]\s*\)/,
  // Dynamic import() type expressions: import('@rust-bridge/...')
  /import\(\s*['"]@rust-bridge\/[^'"]*['"]\s*\)/,
];

const REPRESENTATIVE_SHARED_SYMBOLS = [
  'CellId',
  'SheetId',
  'RowId',
  'ColId',
  'CellValue',
  'CellRange',
  'Workbook',
  'Worksheet',
  'DocumentSource',
  'DocumentStorageConfig',
  'StorageProviderConfig',
];

const LOCAL_SHARED_DECLARATION_PATTERNS = REPRESENTATIVE_SHARED_SYMBOLS.map(
  (symbol) =>
    new RegExp(
      String.raw`^\s*export\s+(?:declare\s+)?(?:interface|class|enum|const|type)\s+${symbol}\b`,
    ),
);

let failed = false;

const CANONICAL_CONTRACT_IMPORTS = `import type { ScreenshotOptions, Workbook, WorkbookSecurity, Worksheet } from '@mog-sdk/contracts/api';
import type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { DocumentImportOptions as ImportOptions, DocumentImportWarning, DocumentSource } from '@mog-sdk/contracts/document';
import type { ColId, FormulaA1 } from '@mog-sdk/contracts/cells';
import type { AccessExplanation, DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { StoreCellData } from '@mog-sdk/contracts/store';
export type { Workbook, Worksheet, ScreenshotOptions, WorkbookSecurity } from '@mog-sdk/contracts/api';
export type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
export type { DocumentImportOptions as ImportOptions, DocumentSource } from '@mog-sdk/contracts/document';
export type { FormulaA1 } from '@mog-sdk/contracts/cells';
`;

function removeExportedTypeAlias(source, name) {
  let next = source;

  while (true) {
    const startMatch = new RegExp(
      String.raw`(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+declare\s+type\s+${name}\s*=`,
    ).exec(next);
    if (!startMatch) return next;

    const start = startMatch.index;
    let index = start + startMatch[0].length;
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;

    while (index < next.length) {
      const char = next[index];
      if (char === '{') braceDepth++;
      else if (char === '}') braceDepth--;
      else if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;
      else if (char === '[') bracketDepth++;
      else if (char === ']') bracketDepth--;
      else if (char === ';' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
        index++;
        break;
      }
      index++;
    }

    while (next[index] === '\r' || next[index] === '\n') {
      index++;
    }

    next = next.slice(0, start) + next.slice(index);
  }
}

function removeExportedInterface(source, name) {
  const startMatch = new RegExp(
    String.raw`(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+declare\s+interface\s+${name}\b[^{]*\{`,
  ).exec(source);
  if (!startMatch) return source;

  const start = startMatch.index;
  let index = start + startMatch[0].length;
  let depth = 1;

  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth++;
    if (char === '}') depth--;
    index++;
  }

  while (source[index] === '\r' || source[index] === '\n') {
    index++;
  }

  return source.slice(0, start) + source.slice(index);
}

function canonicalizeSharedContracts(source) {
  let next = source;

  next = next.replaceAll(CANONICAL_CONTRACT_IMPORTS, '');

  next = next.replace(
    /^import\s+\{\s*AccessExplanation\s*\}\s+from\s+['"]@mog-sdk\/types-document\/security\/evaluator['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*DocumentSecurityConfig\s*\}\s+from\s+['"]@mog-sdk\/types-document\/security\/evaluator['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*DocumentImportWarning(?:\s+as\s+DocumentImportWarning_2)?\s*\}\s+from\s+['"]@mog-sdk\/types-document\/document\/comments['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*DocumentSource\s*\}\s+from\s+['"]@mog-sdk\/types-document\/document\/comments['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*DocumentImportOptions\s+as\s+ImportOptions\s*\}\s+from\s+['"]@mog-sdk\/types-document\/document\/comments['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+type\s+\{\s*ColId\s+as\s+ColId_2\s*\}\s+from\s+['"]@mog\/types-core\/cell-identity['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*ColId(?:\s+as\s+ColId_2)?\s*\}\s+from\s+['"]@mog\/types-core\/cell-identity['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+type\s+\{\s*SheetId\s+as\s+SheetId_3\s*\}\s+from\s+['"]@mog\/types-core\/core['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*SheetId\s+as\s+SheetId_2\s*\}\s+from\s+['"]@mog\/types-core\/core['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*StoreCellData\s*\}\s+from\s+['"]@mog\/types-api\/store['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*FormulaA1\s*\}\s+from\s+['"]@mog\/types-core\/cell-identity['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*RichText\s*\}\s+from\s+['"]@mog\/types-core\/rich-text['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*ScreenshotOptions\s*\}\s+from\s+['"]@mog\/types-api\/api['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*Workbook\s*\}\s+from\s+['"]@mog\/types-api\/api['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*WorkbookSecurity\s*\}\s+from\s+['"]@mog\/types-api\/api['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^import\s+\{\s*Worksheet\s*\}\s+from\s+['"]@mog\/types-api\/api['"];\r?\n/gm,
    '',
  );

  next = next
    .replace(/\bColId_2\b/g, 'ColId')
    .replace(/\bSheetId_3\b/g, 'SheetId')
    .replace(/\bSheetId_2\b/g, 'SheetId')
    .replace(/\bDocumentImportWarning_2\b/g, 'DocumentImportWarning');

  for (const name of [
    'CellRawValue',
    'CellValue',
    'DocumentSource',
    'FormulaA1',
    'ImportOptions',
    'SheetId',
  ]) {
    next = removeExportedTypeAlias(next, name);
  }
  for (const name of ['ScreenshotOptions', 'Workbook', 'WorkbookSecurity', 'Worksheet']) {
    next = removeExportedInterface(next, name);
  }

  next = next.replace(
    /^export\s+\{\s*(?:AccessExplanation|CellRawValue|CellValue|DocumentSecurityConfig|DocumentSource|FormulaA1|ImportOptions|ScreenshotOptions|SheetId|StoreCellData|Workbook|WorkbookSecurity|Worksheet)\s*\}\s*;?\r?\n/gm,
    '',
  );
  next = next.replace(
    /^export\s+type\s+\{[^}]*\b(?:CellRawValue|CellValue|SheetId)\b[^}]*\}\s+from\s+['"]@mog-sdk\/contracts\/core['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^export\s+type\s+\{[^}]*\bFormulaA1\b[^}]*\}\s+from\s+['"]@mog-sdk\/contracts\/cells['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^export\s+type\s+\{[^}]*\b(?:Workbook|Worksheet|ScreenshotOptions|WorkbookSecurity)\b[^}]*\}\s+from\s+['"]@mog-sdk\/contracts\/api['"];\r?\n/gm,
    '',
  );
  next = next.replace(
    /^export\s+type\s+\{[^}]*\b(?:DocumentImportOptions|ImportOptions|DocumentSource)\b[^}]*\}\s+from\s+['"]@mog-sdk\/contracts\/document['"];\r?\n/gm,
    '',
  );

  return CANONICAL_CONTRACT_IMPORTS + next;
}

const esmDeclaration = resolve(DIST, 'index.d.ts');
const cjsDeclaration = resolve(DIST, 'index.d.cts');

if (!existsSync(esmDeclaration)) {
  console.error('ERROR: dist/index.d.ts was not generated.');
  process.exit(1);
}

copyFileSync(esmDeclaration, cjsDeclaration);

for (const filepath of [esmDeclaration, cjsDeclaration]) {
  const source = readFileSync(filepath, 'utf-8');
  const normalized = canonicalizeSharedContracts(source.replace(/@mog\/sdk/g, '@mog-sdk/sdk'));
  if (normalized !== source) {
    writeFileSync(filepath, normalized);
  }
}

function findDeclarationArtifacts(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findDeclarationArtifacts(fullPath));
      continue;
    }
    if (
      entry.endsWith('.d.ts') ||
      entry.endsWith('.d.cts') ||
      entry.endsWith('.d.mts') ||
      entry.endsWith('.d.ts.map') ||
      entry.endsWith('.d.cts.map') ||
      entry.endsWith('.d.mts.map')
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

for (const artifact of findDeclarationArtifacts(DIST)) {
  const relativePath = artifact.slice(DIST.length + 1);
  if (!PUBLIC_DECLARATIONS.has(relativePath)) {
    unlinkSync(artifact);
  }
}

for (const filename of PUBLIC_DECLARATIONS) {
  const filepath = resolve(DIST, filename);
  if (!existsSync(filepath)) {
    console.error(`ERROR: Missing public declaration artifact: ${filename}`);
    failed = true;
  }
}

for (const filename of PUBLIC_DECLARATIONS) {
  const filepath = resolve(DIST, filename);
  if (!existsSync(filepath)) continue;

  const lines = readFileSync(filepath, 'utf-8').split('\n');

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of INTERNAL_PATTERNS) {
      if (pattern.test(lines[i])) {
        if (!failed) {
          console.error('ERROR: Internal imports leaked into published .d.ts:\n');
        }
        console.error(`  ${filename}:${i + 1}: ${lines[i].trim()}`);
        failed = true;
        break; // one match per line is enough
      }
    }
    for (const pattern of LOCAL_SHARED_DECLARATION_PATTERNS) {
      if (pattern.test(lines[i])) {
        if (!failed) {
          console.error('ERROR: Shared contract identities were bundled into published .d.ts:\n');
        }
        console.error(`  ${filename}:${i + 1}: ${lines[i].trim()}`);
        failed = true;
        break;
      }
    }
  }
}

if (failed) {
  console.error(
    '\nFix: import/re-export shared SDK identities from @mog-sdk/contracts instead of bundling them locally.',
  );
  process.exit(1);
}

console.log('Type declarations validated — no internal imports or bundled shared identities.');
