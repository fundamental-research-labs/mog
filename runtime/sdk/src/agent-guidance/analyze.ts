import { apiGuidanceCatalog } from './catalog';
import { apiCompatibility } from '../api-compatibility/index';
import type {
  ApiGuidanceDiagnostic,
  ApiGuidanceEntry,
  ApiGuidanceMatcher,
  ApiGuidancePreflightResult,
  ApiGuidanceSymbolMatcher,
  MogReplacement,
  SourceSpan,
} from './types';
import type { ApiCompatibilityEntry } from '../api-compatibility/types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCommentsAndStrings(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (ch === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      output += ' ';
      index += 1;
      while (index < source.length) {
        const current = source[index];
        output += current === '\n' ? '\n' : ' ';
        index += 1;
        if (current === '\\') {
          if (index < source.length) {
            output += source[index] === '\n' ? '\n' : ' ';
            index += 1;
          }
          continue;
        }
        if (current === quote) break;
      }
      continue;
    }

    output += ch;
    index += 1;
  }

  return output;
}

function spanFor(source: string, start: number, end: number): SourceSpan {
  const prefix = source.slice(0, start);
  const lines = prefix.split('\n');
  return {
    start,
    end,
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function hasLocalDeclaration(stripped: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  const declaration = new RegExp(`\\b(?:const|let|var|function|class)\\s+${escaped}\\b`);
  const imported = new RegExp(
    `\\bimport\\s+(?:[^;]*\\{[^}]*\\b${escaped}\\b[^}]*\\}|\\*\\s+as\\s+${escaped}\\b|${escaped}\\b)`,
    'm',
  );
  return declaration.test(stripped) || imported.test(stripped);
}

function chainPattern(symbol: string): RegExp {
  const propertySeparator = '\\s*\\??\\.\\s*';
  if (symbol.startsWith('.')) {
    const parts = symbol.slice(1).split('.');
    return new RegExp(`\\.\\s*${parts.map(escapeRegExp).join(propertySeparator)}\\b`, 'g');
  }
  const parts = symbol.split('.');
  return new RegExp(`\\b${parts.map(escapeRegExp).join(propertySeparator)}\\b`, 'g');
}

function callPattern(symbol: string): RegExp {
  const base = chainPattern(symbol).source.replace(/\\b$/, '');
  return new RegExp(`${base}\\s*\\(`, 'g');
}

function assignmentPattern(symbol: string): RegExp {
  const property = symbol.match(/\.([A-Za-z_$][\w$]*)(?:\s*=)?$/)?.[1];
  if (!property) return chainPattern(symbol);
  return new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*${escapeRegExp(property)}\\s*=`, 'g');
}

function patternFor(matcher: ApiGuidanceSymbolMatcher): RegExp {
  if (matcher.kind === 'call') return callPattern(matcher.symbol);
  if (matcher.kind === 'assignment') return assignmentPattern(matcher.symbol);
  return chainPattern(matcher.symbol);
}

function compatibilityPattern(entry: ApiCompatibilityEntry): RegExp | null {
  const path = entry.observedPath.trim();
  if (
    !path.startsWith('ws.') &&
    !path.startsWith('wb.') &&
    !path.startsWith('workbook.') &&
    !path.startsWith('chart.')
  ) {
    return null;
  }

  if (isPivotHandleDescribePath(path)) {
    return /\bws\s*\.\s*pivots\s*\.\s*get\s*\([^)]*\)\s*\.\s*describe\s*\(/g;
  }

  const normalized = path.replace(/\(\s*\)$/, '');
  if (!/^(ws|wb|workbook|chart)(?:\.[A-Za-z_$][\w$]*)+$/.test(normalized)) return null;
  return callPattern(normalized);
}

function isPivotHandleDescribePath(path: string): boolean {
  return path === 'ws.pivots.get(...).describe' || path === 'ws.pivots.get(...).describe()';
}

function pivotHandleDescribeMatches(stripped: string): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  const direct = /\bws\s*\.\s*pivots\s*\.\s*get\s*\([^)]*\)\s*\.\s*describe\s*\(/g;
  for (const match of stripped.matchAll(direct)) {
    const start = match.index ?? 0;
    matches.push({ start, end: start + match[0].length });
  }

  const variableNames = new Set<string>();
  const assignment =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?ws\s*\.\s*pivots\s*\.\s*get\s*\([^;]*?\)/g;
  for (const match of stripped.matchAll(assignment)) {
    variableNames.add(match[1]);
  }

  for (const name of variableNames) {
    const handleDescribe = new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*describe\\s*\\(`, 'g');
    for (const match of stripped.matchAll(handleDescribe)) {
      const start = match.index ?? 0;
      matches.push({ start, end: start + match[0].length });
    }
  }

  return matches;
}

function findSymbol(stripped: string, symbol: string): { start: number; end: number } | null {
  const matcher: ApiGuidanceSymbolMatcher = {
    id: 'adhoc',
    kind: symbol.endsWith('=') ? 'assignment' : 'member-chain',
    symbol,
  };
  const match = patternFor(matcher).exec(stripped);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function shouldSuppressLocalFalsePositive(
  stripped: string,
  matcher: ApiGuidanceSymbolMatcher,
): boolean {
  const excelIsLocal = hasLocalDeclaration(stripped, 'Excel');
  const officeIsLocal = hasLocalDeclaration(stripped, 'Office');
  const contextIsLocal = hasLocalDeclaration(stripped, 'context');
  const hasOfficeSignal =
    (!excelIsLocal && /Excel\s*\.\s*run\s*\(/.test(stripped)) ||
    (!officeIsLocal && /Office\s*\.\s*context/.test(stripped)) ||
    (!contextIsLocal &&
      (/context\s*\.\s*workbook/.test(stripped) || /context\s*\.\s*sync\s*\(/.test(stripped)));
  const requiresOfficeSignal = new Set([
    'worksheet.tables.add',
    'sheet.tables.add',
    'table.rows.add',
    'table.columns.add',
    'table.sort.apply',
    'column.filter.applyValuesFilter',
    'worksheet.autoFilter.apply',
    'sheet.autoFilter.apply',
    'names.items',
  ]);

  if (requiresOfficeSignal.has(matcher.symbol) && !hasOfficeSignal) {
    return true;
  }

  if (matcher.symbol.startsWith('Excel.') && excelIsLocal) {
    return true;
  }
  if (matcher.symbol.startsWith('Office.') && officeIsLocal) {
    return true;
  }
  if (matcher.symbol.startsWith('context.') && contextIsLocal) {
    return true;
  }
  return false;
}

function referencesFor(replacements: readonly MogReplacement[]): string[] {
  return replacements.map((replacement) => `api.guidance.explain("${replacement.path}")`);
}

function replacementsForCompatibility(entry: ApiCompatibilityEntry): MogReplacement[] {
  const paths = entry.diagnostics?.replacements?.length
    ? entry.diagnostics.replacements
    : entry.canonicalPath
      ? [entry.canonicalPath]
      : [];
  return paths
    .filter(
      (path) =>
        path.startsWith('ws.') ||
        path.startsWith('wb.') ||
        path.startsWith('workbook.') ||
        path.startsWith('a1.') ||
        path.startsWith('api.utils.') ||
        path.startsWith('Utils.') ||
        path.startsWith('type:') ||
        [
          'a1',
          'address',
          'rangeAddress',
          'columnName',
          'columnIndex',
          'offset',
          'parseAddress',
        ].includes(path),
    )
    .map((path) => ({ path }));
}

function compatibilityReferences(entry: ApiCompatibilityEntry): string[] {
  const refs = [`api.guidance.explain("${entry.observedPath}")`];
  if (entry.canonicalPath) refs.push(`api.guidance.explain("${entry.canonicalPath}")`);
  return refs;
}

interface SourceMatch {
  readonly start: number;
  readonly end: number;
}

interface RootCallMatch extends SourceMatch {
  readonly name: string;
}

interface WorkbookMemberCallMatch extends SourceMatch {
  readonly workbookAlias: 'workbook' | 'wb';
  readonly member: string;
}

interface NamespaceGuess {
  readonly id: string;
  readonly category: ApiGuidanceDiagnostic['category'];
  readonly globalCalls?: readonly string[];
  readonly workbookMethods?: readonly string[];
  readonly message: string;
  readonly suggestion: string;
  readonly replacements: readonly MogReplacement[];
}

const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

const COMMON_WORKSHEET_METHODS = new Set([
  'setCell',
  'setValue',
  'getCell',
  'getValue',
  'setRange',
  'getRange',
  'getValues',
  'setFormula',
  'setFormulas',
  'evaluate',
  'evaluateFormula',
  'validateFormula',
  'describe',
  'describeRange',
  'summarize',
]);

const NAMESPACE_GUESSES: readonly NamespaceGuess[] = [
  {
    id: 'mog-api.namespace.loadWorkbook.unsupported',
    category: 'bootstrap',
    globalCalls: ['loadWorkbook'],
    workbookMethods: ['loadWorkbook'],
    message: '`loadWorkbook` is not a workbook method or execute_code sandbox global.',
    suggestion:
      'Inside execute_code, use the injected `workbook` / `wb`. At the SDK boundary, open files with `const wb = await createWorkbook(pathOrBytes)`.',
    replacements: [
      {
        path: 'createWorkbook',
        snippet: 'const wb = await createWorkbook(pathOrBytes);',
        note: 'Use outside execute_code when opening a workbook from a file path or bytes.',
      },
      {
        path: 'wb.activeSheet',
        snippet: 'const ws = wb.activeSheet;',
        note: 'Inside execute_code the active workbook is already injected.',
      },
    ],
  },
  {
    id: 'mog-api.namespace.saveWorkbook.unsupported',
    category: 'workbook',
    globalCalls: ['saveWorkbook'],
    workbookMethods: ['saveWorkbook'],
    message: '`saveWorkbook` is not a Mog workbook method or sandbox global.',
    suggestion:
      'Save the active workbook with `await wb.save(path)` or get bytes with `await wb.toXlsx()`.',
    replacements: [
      { path: 'wb.save', snippet: 'await wb.save(path);' },
      { path: 'wb.toXlsx', snippet: 'const bytes = await wb.toXlsx();' },
    ],
  },
  {
    id: 'mog-api.namespace.errorCheck.unsupported',
    category: 'workbook',
    globalCalls: ['errorCheck'],
    workbookMethods: ['errorCheck'],
    message: '`errorCheck` is not a Mog workbook method or sandbox global.',
    suggestion:
      'Use workbook diagnostics explicitly: formula-reference diagnostics, import diagnostics, or runtime diagnostics under `wb.diagnostics`.',
    replacements: [
      {
        path: 'wb.diagnostics.getFormulaReferences',
        snippet: 'const page = await wb.diagnostics.getFormulaReferences();',
      },
      {
        path: 'wb.diagnostics.import',
        snippet: 'const importDiagnostics = await wb.diagnostics.import();',
      },
      {
        path: 'wb.diagnostics.runtime',
        snippet: 'const runtimeDiagnostics = await wb.diagnostics.runtime();',
      },
    ],
  },
  {
    id: 'mog-api.namespace.calculate.global',
    category: 'workbook',
    globalCalls: ['calculate'],
    message: '`calculate()` is not a sandbox global.',
    suggestion: 'Recalculate through the active workbook: `await wb.calculate()`.',
    replacements: [{ path: 'wb.calculate', snippet: 'await wb.calculate();' }],
  },
  {
    id: 'mog-api.namespace.getSheet.global',
    category: 'workbook',
    globalCalls: ['getSheet'],
    message: '`getSheet(...)` is not a sandbox global.',
    suggestion:
      'Resolve sheets from the workbook with `await wb.getSheet(name)`, or use `ws` / `worksheet` for the active sheet.',
    replacements: [
      { path: 'wb.getSheet', snippet: 'const ws = await wb.getSheet(name);' },
      { path: 'wb.activeSheet', snippet: 'const ws = wb.activeSheet;' },
    ],
  },
];

function rootCallMatches(stripped: string, name: string): RootCallMatch[] {
  if (hasLocalDeclaration(stripped, name)) return [];

  const pattern = new RegExp(`(^|[^\\w$.])(${escapeRegExp(name)}\\s*\\()`, 'g');
  const matches: RootCallMatch[] = [];
  for (const match of stripped.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[1].length;
    matches.push({ name, start, end: start + match[2].length });
  }
  return matches;
}

function workbookMemberCallMatches(stripped: string, member: string): WorkbookMemberCallMatch[] {
  const pattern = new RegExp(`\\b(workbook|wb)\\s*\\.\\s*${escapeRegExp(member)}\\s*\\(`, 'g');
  const matches: WorkbookMemberCallMatch[] = [];
  for (const match of stripped.matchAll(pattern)) {
    const start = match.index ?? 0;
    matches.push({
      workbookAlias: match[1] as 'workbook' | 'wb',
      member,
      start,
      end: start + match[0].length,
    });
  }
  return matches;
}

function namespaceGuessMatches(stripped: string): Array<{
  readonly guess: NamespaceGuess;
  readonly matcherId: string;
  readonly offendingSymbol: string;
  readonly start: number;
  readonly end: number;
}> {
  const matches: Array<{
    guess: NamespaceGuess;
    matcherId: string;
    offendingSymbol: string;
    start: number;
    end: number;
  }> = [];

  for (const guess of NAMESPACE_GUESSES) {
    for (const name of guess.globalCalls ?? []) {
      for (const match of rootCallMatches(stripped, name)) {
        matches.push({
          guess,
          matcherId: `${guess.id}.global.${name}`,
          offendingSymbol: `${name}(...)`,
          start: match.start,
          end: match.end,
        });
      }
    }

    for (const member of guess.workbookMethods ?? []) {
      for (const match of workbookMemberCallMatches(stripped, member)) {
        matches.push({
          guess,
          matcherId: `${guess.id}.${match.workbookAlias}.${member}`,
          offendingSymbol: `${match.workbookAlias}.${member}(...)`,
          start: match.start,
          end: match.end,
        });
      }
    }
  }

  return matches;
}

function workbookWorksheetMethodMatches(stripped: string): WorkbookMemberCallMatch[] {
  const pattern = /\b(workbook|wb)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  const matches: WorkbookMemberCallMatch[] = [];

  for (const match of stripped.matchAll(pattern)) {
    const member = match[2];
    if (!COMMON_WORKSHEET_METHODS.has(member)) continue;
    const start = match.index ?? 0;
    matches.push({
      workbookAlias: match[1] as 'workbook' | 'wb',
      member,
      start,
      end: start + match[0].length,
    });
  }

  return matches;
}

function getSheetMissingAwaitMatches(stripped: string): Array<{
  workbookAlias: 'workbook' | 'wb';
  worksheetMethod: string;
  start: number;
  end: number;
}> {
  const matches: Array<{
    workbookAlias: 'workbook' | 'wb';
    worksheetMethod: string;
    start: number;
    end: number;
  }> = [];
  const pattern = /\b(workbook|wb)\s*\.\s*getSheet\s*\([^)]*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;

  for (const match of stripped.matchAll(pattern)) {
    const workbookAlias = match[1] as 'workbook' | 'wb';
    const worksheetMethod = match[2];
    if (PROMISE_METHODS.has(worksheetMethod)) continue;
    const start = match.index ?? 0;
    matches.push({ workbookAlias, worksheetMethod, start, end: start + match[0].length });
  }

  return matches;
}

function spansOverlap(left: SourceSpan | undefined, right: SourceSpan | undefined): boolean {
  if (!left || !right) return false;
  return left.start <= right.end && right.start <= left.end;
}

function spanWidth(span: SourceSpan | undefined): number {
  return span ? span.end - span.start : 0;
}

function preferDiagnostic(
  existing: ApiGuidanceDiagnostic,
  candidate: ApiGuidanceDiagnostic,
): ApiGuidanceDiagnostic {
  if (candidate.confidence !== existing.confidence) {
    return candidate.confidence > existing.confidence ? candidate : existing;
  }
  if (candidate.blocking !== existing.blocking) {
    return candidate.blocking ? candidate : existing;
  }
  return spanWidth(candidate.span) > spanWidth(existing.span) ? candidate : existing;
}

function coalesceOverlappingDiagnostics(
  diagnostics: readonly ApiGuidanceDiagnostic[],
): ApiGuidanceDiagnostic[] {
  const coalesced: ApiGuidanceDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const overlappingIndex = coalesced.findIndex(
      (existing) =>
        existing.entryId === diagnostic.entryId && spansOverlap(existing.span, diagnostic.span),
    );
    if (overlappingIndex < 0) {
      coalesced.push(diagnostic);
      continue;
    }

    coalesced[overlappingIndex] = preferDiagnostic(coalesced[overlappingIndex], diagnostic);
  }

  return coalesced;
}

export function diagnosticFromGuidanceEntry(
  entry: ApiGuidanceEntry,
  matcher: ApiGuidanceMatcher,
  offendingSymbol: string,
  span?: SourceSpan,
): ApiGuidanceDiagnostic {
  const confidence = matcher.confidence ?? entry.confidence;
  const blocking = matcher.blocking ?? entry.blocking;
  return {
    code: 'MOG001_FOREIGN_API_DIALECT',
    severity: blocking ? 'error' : 'warning',
    dialect: entry.dialect,
    category: entry.category,
    entryId: entry.id,
    matcherId: matcher.id,
    offendingSymbol,
    message: entry.message,
    suggestion: entry.suggestion,
    mogReplacements: entry.mogReplacements,
    references: referencesFor(entry.mogReplacements),
    confidence,
    blocking,
    ...(span ? { span } : {}),
  };
}

export function diagnosticFromCompatibilityEntry(
  entry: ApiCompatibilityEntry,
  span?: SourceSpan,
): ApiGuidanceDiagnostic {
  const blocking = entry.status === 'structured_diagnostic' || entry.status === 'rejected';
  const deprecated = entry.status === 'deprecated_alias';
  const replacements = replacementsForCompatibility(entry);
  return {
    code:
      entry.diagnostics?.code ??
      (entry.status === 'rejected' ? 'MOG003_COMPATIBILITY_REJECTED' : 'MOG002_MOG_API_USAGE'),
    severity: blocking ? 'error' : deprecated ? 'warning' : 'info',
    dialect: 'mog-version',
    category:
      entry.observedPath.includes('.charts') || entry.observedPath.includes('Chart')
        ? 'charts'
        : entry.observedPath.includes('.pivots') || entry.observedPath.includes('Pivot')
          ? 'pivots'
          : 'compatibility',
    entryId: entry.id,
    matcherId: `compatibility.${entry.id}`,
    offendingSymbol: entry.observedPath,
    message: entry.diagnostics?.message ?? entry.behavior,
    suggestion:
      entry.diagnostics?.message ??
      (entry.canonicalPath
        ? `Use ${entry.canonicalPath} for the canonical Mog API path.`
        : entry.behavior),
    mogReplacements: replacements,
    references: compatibilityReferences(entry),
    confidence: 0.99,
    blocking,
    compatibilityId: entry.id,
    compatibilityStatus: entry.status,
    ...(span ? { span } : {}),
  };
}

function diagnosticFromGetSheetMissingAwait(
  workbookAlias: 'workbook' | 'wb',
  worksheetMethod: string,
  span?: SourceSpan,
): ApiGuidanceDiagnostic {
  const getSheetPath = `${workbookAlias}.getSheet`;
  const worksheetPath = `ws.${worksheetMethod}`;
  return {
    code: 'MOG002_MOG_API_USAGE',
    severity: 'error',
    dialect: 'mog-version',
    category: 'workbook',
    entryId: 'mog-api.workbook.getSheet.missing-await',
    matcherId: `compatibility.mog-api.workbook.getSheet.missing-await.${workbookAlias}`,
    offendingSymbol: `${getSheetPath}(...).${worksheetMethod}`,
    message: `getSheet is async, so ${getSheetPath}(...).${worksheetMethod}(...) tries to call ${worksheetMethod} on a Promise instead of a worksheet.`,
    suggestion: `Await getSheet first: const ws = await ${workbookAlias}.getSheet(name); await ws.${worksheetMethod}(...);`,
    mogReplacements: [
      {
        path: getSheetPath,
        snippet: `const ws = await ${workbookAlias}.getSheet(name);`,
        note: 'Resolve the worksheet before calling worksheet methods.',
      },
      { path: worksheetPath, snippet: `await ws.${worksheetMethod}(...);` },
    ],
    references: [
      `api.guidance.explain("${getSheetPath}")`,
      `api.guidance.explain("${worksheetPath}")`,
    ],
    confidence: 0.99,
    blocking: true,
    compatibilityStatus: 'structured_diagnostic',
    ...(span ? { span } : {}),
  };
}

function diagnosticFromNamespaceGuess(
  guess: NamespaceGuess,
  matcherId: string,
  offendingSymbol: string,
  span?: SourceSpan,
): ApiGuidanceDiagnostic {
  return {
    code: 'MOG002_MOG_API_USAGE',
    severity: 'error',
    dialect: 'mog-version',
    category: guess.category,
    entryId: guess.id,
    matcherId,
    offendingSymbol,
    message: guess.message,
    suggestion: guess.suggestion,
    mogReplacements: guess.replacements,
    references: referencesFor(guess.replacements),
    confidence: 0.99,
    blocking: true,
    compatibilityStatus: 'structured_diagnostic',
    ...(span ? { span } : {}),
  };
}

function diagnosticFromWorkbookWorksheetMethod(
  match: WorkbookMemberCallMatch,
  span?: SourceSpan,
): ApiGuidanceDiagnostic {
  const workbookPath = `${match.workbookAlias}.${match.member}`;
  const worksheetPath = `ws.${match.member}`;
  return {
    code: 'MOG002_MOG_API_USAGE',
    severity: 'error',
    dialect: 'mog-version',
    category: 'workbook',
    entryId: 'mog-api.namespace.workbook-worksheet-method',
    matcherId: `compatibility.mog-api.namespace.workbook-worksheet-method.${match.workbookAlias}.${match.member}`,
    offendingSymbol: `${workbookPath}(...)`,
    message: `${workbookPath}(...) treats the workbook as a worksheet. Worksheet cell/range methods live on a worksheet object.`,
    suggestion: `Use the active sheet via \`const ws = ${match.workbookAlias}.activeSheet\`, or resolve a named sheet with \`const ws = await ${match.workbookAlias}.getSheet(name)\`, then call \`await ws.${match.member}(...)\`.`,
    mogReplacements: [
      {
        path: 'wb.activeSheet',
        snippet: `const ws = ${match.workbookAlias}.activeSheet;`,
      },
      {
        path: `${match.workbookAlias}.getSheet`,
        snippet: `const ws = await ${match.workbookAlias}.getSheet(name);`,
      },
      { path: worksheetPath, snippet: `await ws.${match.member}(...);` },
    ],
    references: [
      'api.guidance.explain("wb.activeSheet")',
      `api.guidance.explain("${match.workbookAlias}.getSheet")`,
      `api.guidance.explain("${worksheetPath}")`,
    ],
    confidence: 0.99,
    blocking: true,
    compatibilityStatus: 'structured_diagnostic',
    ...(span ? { span } : {}),
  };
}

export function analyzeMogCode(code: string): ApiGuidanceDiagnostic[] {
  const stripped = stripCommentsAndStrings(code);
  const diagnostics: ApiGuidanceDiagnostic[] = [];
  const seen = new Set<string>();

  for (const entry of apiGuidanceCatalog) {
    for (const matcher of entry.matchers) {
      if (matcher.kind === 'compound') {
        const found: Array<{ symbol: string; span: { start: number; end: number } }> = [];
        for (const symbol of matcher.symbols) {
          const span = findSymbol(stripped, symbol);
          if (span) found.push({ symbol, span });
        }
        if (found.length !== matcher.symbols.length) continue;
        const first = found[0];
        const span = spanFor(code, first.span.start, first.span.end);
        const key = `${entry.id}:${matcher.id}:${span.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push(diagnosticFromGuidanceEntry(entry, matcher, first.symbol, span));
        continue;
      }

      if (shouldSuppressLocalFalsePositive(stripped, matcher)) continue;

      const pattern = patternFor(matcher);
      for (const match of stripped.matchAll(pattern)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const span = spanFor(code, start, end);
        const key = `${entry.id}:${matcher.id}:${span.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push(diagnosticFromGuidanceEntry(entry, matcher, matcher.symbol, span));
      }
    }
  }

  for (const match of getSheetMissingAwaitMatches(stripped)) {
    const span = spanFor(code, match.start, match.end);
    const key = `mog-api.workbook.getSheet.missing-await:${span.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(
      diagnosticFromGetSheetMissingAwait(match.workbookAlias, match.worksheetMethod, span),
    );
  }

  for (const match of namespaceGuessMatches(stripped)) {
    const span = spanFor(code, match.start, match.end);
    const key = `${match.guess.id}:${match.matcherId}:${span.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(
      diagnosticFromNamespaceGuess(match.guess, match.matcherId, match.offendingSymbol, span),
    );
  }

  for (const match of workbookWorksheetMethodMatches(stripped)) {
    const span = spanFor(code, match.start, match.end);
    const key = `mog-api.namespace.workbook-worksheet-method:${match.member}:${span.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnosticFromWorkbookWorksheetMethod(match, span));
  }

  for (const entry of apiCompatibility.entries) {
    if (
      entry.status !== 'deprecated_alias' &&
      entry.status !== 'structured_diagnostic' &&
      entry.status !== 'rejected'
    ) {
      continue;
    }
    const directMatches = isPivotHandleDescribePath(entry.observedPath)
      ? pivotHandleDescribeMatches(stripped)
      : null;
    const pattern = directMatches ? null : compatibilityPattern(entry);
    if (!directMatches && !pattern) continue;
    const matches =
      directMatches ??
      Array.from(stripped.matchAll(pattern!)).map((match) => {
        const start = match.index ?? 0;
        return { start, end: start + match[0].length };
      });
    for (const match of matches) {
      const { start, end } = match;
      const span = spanFor(code, start, end);
      const key = `${entry.id}:${span.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(diagnosticFromCompatibilityEntry(entry, span));
    }
  }

  return coalesceOverlappingDiagnostics(diagnostics).sort(
    (a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0),
  );
}

export function preflightMogCode(code: string): ApiGuidancePreflightResult {
  const diagnostics = analyzeMogCode(code);
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.blocking),
    diagnostics,
  };
}
