import { apiGuidanceCatalog } from './catalog';
import type {
  ApiGuidanceDiagnostic,
  ApiGuidanceEntry,
  ApiGuidanceMatcher,
  ApiGuidancePreflightResult,
  ApiGuidanceSymbolMatcher,
  MogReplacement,
  SourceSpan,
} from './types';

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
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${escapeRegExp(name)}\\b`).test(
    stripped,
  );
}

function chainPattern(symbol: string): RegExp {
  if (symbol.startsWith('.')) {
    const parts = symbol.slice(1).split('.');
    return new RegExp(`\\.\\s*${parts.map(escapeRegExp).join('\\s*\\.\\s*')}\\b`, 'g');
  }
  const parts = symbol.split('.');
  return new RegExp(`\\b${parts.map(escapeRegExp).join('\\s*\\.\\s*')}\\b`, 'g');
}

function callPattern(symbol: string): RegExp {
  const base = chainPattern(symbol).source.replace(/\\b$/, '');
  return new RegExp(`${base}\\s*\\(`, 'g');
}

function assignmentPattern(symbol: string): RegExp {
  const property = symbol.match(/\.([A-Za-z_$][\w$]*)\s*=/)?.[1];
  if (!property) return chainPattern(symbol);
  return new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*${escapeRegExp(property)}\\s*=`, 'g');
}

function patternFor(matcher: ApiGuidanceSymbolMatcher): RegExp {
  if (matcher.kind === 'call') return callPattern(matcher.symbol);
  if (matcher.kind === 'assignment') return assignmentPattern(matcher.symbol);
  return chainPattern(matcher.symbol);
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
  if (matcher.symbol.startsWith('Excel.') && hasLocalDeclaration(stripped, 'Excel')) {
    return true;
  }
  if (matcher.symbol.startsWith('Office.') && hasLocalDeclaration(stripped, 'Office')) {
    return true;
  }
  if (matcher.symbol.startsWith('context.') && hasLocalDeclaration(stripped, 'context')) {
    return true;
  }
  return false;
}

function referencesFor(replacements: readonly MogReplacement[]): string[] {
  return replacements.map((replacement) =>
    replacement.path.includes('.')
      ? `api.guidance.explain("${replacement.path}")`
      : `api.describe()`,
  );
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

  return diagnostics.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
}

export function preflightMogCode(code: string): ApiGuidancePreflightResult {
  const diagnostics = analyzeMogCode(code);
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.blocking),
    diagnostics,
  };
}
