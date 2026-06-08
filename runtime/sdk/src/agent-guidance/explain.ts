import { apiGuidanceCatalog } from './catalog';
import { apiCompatibility } from '../api-compatibility/index';
import { diagnosticFromGuidanceEntry } from './analyze';
import { normalizeMogApiPath, resolveGuidanceTarget } from './targets';
import type {
  ApiGuidanceEntry,
  ApiGuidanceExplanation,
  ApiGuidanceMatcher,
  ApiGuidanceSymbolMatcher,
} from './types';

function normalizeSymbol(symbol: string): string {
  return symbol
    .trim()
    .replace(/\(\s*\)$/, '')
    .replace(/\s+/g, '');
}

function inputMatchesSymbol(input: string, matcherSymbol: string): boolean {
  const normalizedInput = normalizeSymbol(input);
  const normalizedMatcher = normalizeSymbol(matcherSymbol);

  if (normalizedMatcher.startsWith('.')) {
    return normalizedInput.endsWith(normalizedMatcher);
  }

  if (normalizedMatcher.includes('.')) {
    return (
      normalizedInput === normalizedMatcher || normalizedInput.endsWith(`.${normalizedMatcher}`)
    );
  }

  return normalizedInput === normalizedMatcher || normalizedInput.endsWith(`.${normalizedMatcher}`);
}

function findForeignMatcher(
  symbol: string,
): { entry: ApiGuidanceEntry; matcher: ApiGuidanceMatcher } | null {
  for (const entry of apiGuidanceCatalog) {
    for (const matcher of entry.matchers) {
      if (matcher.kind === 'compound') {
        if (matcher.symbols.some((candidate) => inputMatchesSymbol(symbol, candidate))) {
          return { entry, matcher };
        }
        continue;
      }

      if (inputMatchesSymbol(symbol, (matcher as ApiGuidanceSymbolMatcher).symbol)) {
        return { entry, matcher };
      }
    }
  }

  return null;
}

function normalizeCompatibilityPath(path: string): string {
  return normalizeMogApiPath(path).replace(/\(\s*\)$/, '');
}

function findObservedCompatibilityEntry(symbolOrPath: string) {
  const normalized = normalizeCompatibilityPath(symbolOrPath);
  return (
    apiCompatibility.byObservedPath[normalized]?.[0] ??
    apiCompatibility.byObservedPath[`${normalized}()`]?.[0] ??
    null
  );
}

function findCanonicalCompatibilityEntry(symbolOrPath: string) {
  const normalized = normalizeCompatibilityPath(symbolOrPath);
  return (
    apiCompatibility.byCanonicalPath[normalized]?.[0] ??
    apiCompatibility.byCanonicalPath[`${normalized}()`]?.[0] ??
    null
  );
}

export function explainApiSymbol(symbolOrPath: string): ApiGuidanceExplanation | null {
  const foreign = findForeignMatcher(symbolOrPath);
  if (foreign) {
    return {
      kind: 'foreign-api-dialect',
      symbol: symbolOrPath,
      entry: foreign.entry,
      diagnostic: diagnosticFromGuidanceEntry(
        foreign.entry,
        foreign.matcher,
        normalizeSymbol(symbolOrPath),
      ),
    };
  }

  const compatibility = findObservedCompatibilityEntry(symbolOrPath);
  if (compatibility) {
    const target = compatibility.canonicalPath
      ? resolveGuidanceTarget(compatibility.canonicalPath)
      : null;
    return {
      kind: 'mog-api-compatibility',
      path: normalizeCompatibilityPath(symbolOrPath),
      entry: compatibility,
      target,
    };
  }

  const path = normalizeMogApiPath(symbolOrPath);
  const target = resolveGuidanceTarget(path);
  if (!target) {
    const canonicalCompatibility = findCanonicalCompatibilityEntry(symbolOrPath);
    if (!canonicalCompatibility) return null;
    return {
      kind: 'mog-api-compatibility',
      path: normalizeCompatibilityPath(symbolOrPath),
      entry: canonicalCompatibility,
      target: null,
    };
  }

  const examples: string[] = [];
  const recommendedBy: string[] = [];

  for (const entry of apiGuidanceCatalog) {
    for (const replacement of entry.mogReplacements) {
      if (normalizeMogApiPath(replacement.path) !== target.path) continue;
      if (replacement.snippet && !examples.includes(replacement.snippet)) {
        examples.push(replacement.snippet);
      }
      if (!recommendedBy.includes(entry.id)) recommendedBy.push(entry.id);
    }
  }

  return {
    kind: 'mog-api',
    path: target.path,
    target,
    examples,
    recommendedBy,
  };
}
