import { KernelError } from '../../errors';

export type SheetLookupNearMatchKind =
  | 'trim-equivalent'
  | 'normalized-whitespace-equivalent'
  | 'fuzzy';

export interface SheetLookupNearMatch {
  readonly name: string;
  readonly visibleName: string;
  readonly matchKind: SheetLookupNearMatchKind;
  readonly score: number;
}

export interface SheetNotFoundErrorOptions {
  readonly target: string | number;
  readonly knownSheetNames?: readonly string[];
  readonly messagePrefix?: string;
  readonly suggestion?: string;
  readonly context?: Record<string, unknown>;
}

const MAX_NEAR_MATCHES = 5;

export function createSheetNotFoundError(options: SheetNotFoundErrorOptions): KernelError {
  const knownSheetNames = uniqueStrings(options.knownSheetNames ?? []);
  const targetVisible =
    typeof options.target === 'string'
      ? renderSheetNameWithWhitespace(options.target)
      : String(options.target);
  const nearMatches =
    typeof options.target === 'string'
      ? findNearSheetNameMatches(options.target, knownSheetNames)
      : [];

  const context: Record<string, unknown> = {
    resourceType: 'sheet',
    target: options.target,
    targetVisible,
    knownSheetNames,
    knownSheetNamesVisible: knownSheetNames.map(renderSheetNameWithWhitespace),
    nearMatches,
    ...options.context,
  };

  if (typeof options.target === 'string') {
    context.resourceName = options.target;
  }

  return new KernelError('API_SHEET_NOT_FOUND', buildSheetNotFoundMessage(options, nearMatches), {
    path: [typeof options.target === 'number' ? 'index' : 'name'],
    suggestion: buildSheetNotFoundSuggestion(options, nearMatches, knownSheetNames.length),
    context,
  });
}

export function renderSheetNameWithWhitespace(name: string): string {
  let rendered = '';
  for (const char of name) {
    switch (char) {
      case ' ':
        rendered += '\\s';
        break;
      case '\t':
        rendered += '\\t';
        break;
      case '\n':
        rendered += '\\n';
        break;
      case '\r':
        rendered += '\\r';
        break;
      case '\f':
        rendered += '\\f';
        break;
      case '\v':
        rendered += '\\v';
        break;
      default:
        rendered += shouldEscapeInvisibleChar(char) ? escapeCodePoint(char) : char;
        break;
    }
  }
  return rendered;
}

export function findNearSheetNameMatches(
  target: string,
  knownSheetNames: readonly string[],
): SheetLookupNearMatch[] {
  const targetLower = target.toLowerCase();
  const targetTrimmedLower = target.trim().toLowerCase();
  const targetNormalized = normalizeWhitespaceForLookup(target);

  return uniqueStrings(knownSheetNames)
    .map((name) => {
      const nameLower = name.toLowerCase();
      if (nameLower === targetLower) return null;

      const nameTrimmedLower = name.trim().toLowerCase();
      if (targetTrimmedLower === nameTrimmedLower) {
        return toNearMatch(name, 'trim-equivalent', 1);
      }

      const normalizedName = normalizeWhitespaceForLookup(name);
      if (targetNormalized === normalizedName) {
        return toNearMatch(name, 'normalized-whitespace-equivalent', 0.98);
      }

      const score = similarityScore(targetNormalized, normalizedName);
      if (!passesFuzzyThreshold(targetNormalized, normalizedName, score)) return null;
      return toNearMatch(name, 'fuzzy', score);
    })
    .filter((match): match is SheetLookupNearMatch => match != null)
    .sort(compareNearMatches)
    .slice(0, MAX_NEAR_MATCHES);
}

function buildSheetNotFoundMessage(
  options: SheetNotFoundErrorOptions,
  nearMatches: readonly SheetLookupNearMatch[],
): string {
  const prefix = options.messagePrefix ?? 'Sheet not found';
  const target =
    typeof options.target === 'string'
      ? quoteVisibleName(options.target)
      : `index ${String(options.target)}`;
  const suggestion = nearMatches[0]
    ? ` Did you mean ${quoteVisibleName(nearMatches[0].name)}?`
    : '';
  return `${prefix}: ${target}.${suggestion}`;
}

function buildSheetNotFoundSuggestion(
  options: SheetNotFoundErrorOptions,
  nearMatches: readonly SheetLookupNearMatch[],
  knownSheetNameCount: number,
): string {
  const parts: string[] = [];
  if (options.suggestion) parts.push(options.suggestion);

  if (nearMatches.length > 0) {
    parts.push(
      `Use the exact sheet name ${nearMatches.map((match) => quoteVisibleName(match.name)).join(', ')}.`,
    );
  } else if (knownSheetNameCount > 0) {
    parts.push('Use getSheetNames() to list available sheet names.');
  }

  parts.push(
    'Sheet name lookup is case-insensitive, but whitespace is significant; visible names escape spaces as \\s.',
  );

  return parts.join(' ');
}

function toNearMatch(
  name: string,
  matchKind: SheetLookupNearMatchKind,
  score: number,
): SheetLookupNearMatch {
  return {
    name,
    visibleName: renderSheetNameWithWhitespace(name),
    matchKind,
    score,
  };
}

function compareNearMatches(a: SheetLookupNearMatch, b: SheetLookupNearMatch): number {
  const rankDelta = matchKindRank(a.matchKind) - matchKindRank(b.matchKind);
  if (rankDelta !== 0) return rankDelta;
  return b.score - a.score;
}

function matchKindRank(kind: SheetLookupNearMatchKind): number {
  switch (kind) {
    case 'trim-equivalent':
      return 0;
    case 'normalized-whitespace-equivalent':
      return 1;
    case 'fuzzy':
      return 2;
  }
}

function quoteVisibleName(name: string): string {
  return `"${renderSheetNameWithWhitespace(name)}"`;
}

function normalizeWhitespaceForLookup(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function passesFuzzyThreshold(a: string, b: string, score: number): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const maxLength = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  const allowedDistance = Math.max(2, Math.floor(maxLength * 0.25));
  return distance <= allowedDistance || score >= 0.72;
}

function similarityScore(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLength;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function shouldEscapeInvisibleChar(char: string): boolean {
  if (/\s/u.test(char)) return true;
  const codePoint = char.codePointAt(0);
  if (codePoint == null) return false;
  return (
    codePoint === 0x00ad ||
    codePoint === 0x061c ||
    codePoint === 0x180e ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  );
}

function escapeCodePoint(char: string): string {
  const codePoint = char.codePointAt(0);
  if (codePoint == null) return char;
  if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
  return `\\u{${codePoint.toString(16)}}`;
}
