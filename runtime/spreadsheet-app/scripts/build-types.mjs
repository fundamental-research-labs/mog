import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DIST = resolve(PKG_ROOT, 'dist');
const PUBLIC_TYPES = resolve(PKG_ROOT, 'src/public-types.ts');
const require = createRequire(import.meta.url);
const ts = require('typescript');

function assertPublicTypesSource(source) {
  const sourceFile = ts.createSourceFile(PUBLIC_TYPES, source, ts.ScriptTarget.Latest, true);
  const errors = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause?.isTypeOnly) {
        errors.push('public-types.ts may only use type-only imports');
      }
      continue;
    }

    const isExported = Boolean(
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (!isExported) {
      errors.push(
        `non-exported top-level statement: ${statement.getText(sourceFile).slice(0, 80)}`,
      );
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      continue;
    }

    errors.push(
      `unsupported public-types.ts export: ${statement.getText(sourceFile).slice(0, 80)}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      [
        'Cannot build @mog-sdk/spreadsheet-app public declarations from src/public-types.ts.',
        ...errors.map((error) => `- ${error}`),
      ].join('\n'),
    );
  }
}

function publicTypeDeclarations() {
  const source = readFileSync(PUBLIC_TYPES, 'utf-8').trim();
  assertPublicTypesSource(source);
  return source;
}

mkdirSync(DIST, { recursive: true });

const lines = [
  '/**',
  ' * Public @mog-sdk/spreadsheet-app facade.',
  ' *',
  ' * This declaration file is intentionally derived from src/public-types.ts.',
  ' * Internal workspace contracts are implementation details of the bundled',
  ' * runtime artifact and are not public npm dependencies.',
  ' */',
  '',
  publicTypeDeclarations(),
  '',
  'export declare function createSpreadsheetRuntime(options: SpreadsheetRuntimeOptions): Promise<SpreadsheetRuntime>;',
  '',
  "export declare const MogSpreadsheetApp: import('react').ForwardRefExoticComponent<MogSpreadsheetAppProps & import('react').RefAttributes<SpreadsheetAppAttachmentHandle>>;",
  '',
  'export declare function mountSpreadsheetApp(container: HTMLElement, props: MogSpreadsheetAppProps): SpreadsheetAppAttachmentHandle;',
  '',
];

writeFileSync(resolve(DIST, 'index.d.ts'), lines.join('\n'));

console.log('\n✓ @mog-sdk/spreadsheet-app public facade declarations written.');
