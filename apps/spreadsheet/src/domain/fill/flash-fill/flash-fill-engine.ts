/**
 * Flash Fill Engine
 *
 * Core pattern detection and synthesis engine for Flash Fill.
 * All functions in this module are pure (no side effects).
 *
 * Flash Fill analyzes user-provided examples to detect transformation patterns
 * and generates values for remaining cells.
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';

import {
  DEFAULT_FLASH_FILL_CONFIG,
  type CaseChangeType,
  type FlashFillConfig,
  type FlashFillContext,
  type FlashFillDetectionResult,
  type FlashFillExample,
  type FlashFillPattern,
  type TokenKind,
  type TransformationStep,
} from './types';

// =============================================================================
// Main Engine Functions
// =============================================================================

/**
 * Detect a Flash Fill pattern from examples.
 *
 * This is the main entry point for Flash Fill pattern detection.
 * It analyzes the provided examples and attempts to synthesize a transformation
 * pattern that can be applied to fill remaining rows.
 *
 * @param context - Flash Fill context containing examples and source data
 * @param config - Configuration options (defaults to DEFAULT_FLASH_FILL_CONFIG)
 * @returns Detection result with pattern and generated values
 */
export function detectFlashFillPattern(
  context: FlashFillContext,
  config: FlashFillConfig = DEFAULT_FLASH_FILL_CONFIG,
): FlashFillDetectionResult {
  const { examples, sourceData, startRow, endRow } = context;

  // Validate minimum examples
  if (examples.length < config.minExamples) {
    return {
      success: false,
      error: `At least ${config.minExamples} example(s) required`,
    };
  }

  // Try different pattern detection strategies
  // Note: All detectors receive the full context to access startRow for correct array indexing
  //
  // Order matters: the template detector is the most general — it handles
  // token-based extraction, multi-column concat with literal separators, and
  // case-transformed token templates (e.g. "first.last@acme.com"). It is tried
  // first because it produces token-aware patterns instead of brittle
  // character-offset extractions. Specialized detectors below are kept as
  // fallbacks for whole-source transforms the template cannot express
  // (e.g. case-change of the entire source string, single-substring replace).
  const detectors = [
    detectTemplatePattern,
    detectCaseChangePattern,
    detectExtractionPattern,
    detectCombinePattern,
    detectSplitPattern,
    detectPrefixSuffixPattern,
    detectReplacePattern,
  ];

  for (const detector of detectors) {
    const pattern = detector(context);
    if (pattern && pattern.confidence >= config.minConfidence) {
      // Generate values for all rows using the detected pattern
      const values = generateValues(pattern, sourceData, startRow, endRow, examples);
      return {
        success: true,
        pattern,
        values,
        filledRows: getFilledRows(startRow, endRow, examples),
      };
    }
  }

  return {
    success: false,
    error: 'Could not detect a transformation pattern from the examples',
  };
}

/**
 * Apply a Flash Fill pattern to generate a single value.
 *
 * @param pattern - The pattern to apply
 * @param sourceValues - Source values for this row
 * @returns The generated value
 */
export function applyPattern(pattern: FlashFillPattern, sourceValues: CellValue[]): CellValue {
  let result = '';

  // step.sourceColumn stores the original *sheet* column index. The
  // sourceValues array passed by generateValues is parallel to
  // pattern.sourceColumns, so resolve each step's column via that mapping.
  // (Falls back to direct indexing for legacy callers / single-column
  // patterns where sheet-col happens to equal array-idx.)
  const colToIdx = new Map<number, number>();
  for (let i = 0; i < pattern.sourceColumns.length; i++) {
    colToIdx.set(pattern.sourceColumns[i], i);
  }
  const resolveIdx = (sheetCol: number | undefined): number => {
    if (sheetCol == null) return 0;
    const idx = colToIdx.get(sheetCol);
    return idx != null ? idx : sheetCol;
  };

  for (const step of pattern.steps) {
    const sourceIndex = resolveIdx(step.sourceColumn);
    const sourceValue = sourceValues[sourceIndex];
    const sourceStr = sourceValue != null ? String(sourceValue) : '';

    switch (step.type) {
      case 'extract_position':
        result += extractByPosition(sourceStr, step.position!);
        break;

      case 'extract_delimiter':
        result += extractByDelimiter(sourceStr, step.delimiter!, step.wordIndex ?? 0);
        break;

      case 'extract_word':
        result += extractWord(sourceStr, step.wordIndex ?? 0);
        break;

      case 'literal':
        result += step.literal ?? '';
        break;

      case 'case_change':
        result += applyCase(sourceStr, step.caseChange ?? 'none');
        break;

      case 'replace':
        result += sourceStr.replace(step.replace!.from, step.replace!.to);
        break;

      case 'token': {
        // Template-detector token step: tokenize the source value with the
        // recorded kind, take the recorded index, optional case, and
        // optional fixed prefix length.
        const tokens = tokenizeSource(sourceStr, step.tokenKind ?? 'whitespace');
        const tok = tokens[step.tokenIndex ?? 0] ?? '';
        const cased = applyCase(tok, step.caseChange ?? 'none');
        result += step.tokenPrefixLen != null ? cased.substring(0, step.tokenPrefixLen) : cased;
        break;
      }
    }
  }

  return result;
}

// =============================================================================
// Template Pattern Detection
// =============================================================================

/**
 * Tokenize a source string for template matching.
 *
 * - 'full': the whole string as a single token (idx 0)
 * - 'whitespace': split on whitespace, dropping empty splits
 * - 'delimiter': split on `[\s,.\-/_]+`, dropping empty splits
 *
 * The three kinds are used together as candidate generators when matching a
 * template against an example output: the matcher picks whichever kind/index
 * yields the longest substring match at each output position. This produces a
 * single mechanism that subsumes "extract first word", "concat columns with a
 * literal separator", and "extract digit run from delimited string".
 */
function tokenizeSource(source: string, kind: TokenKind): string[] {
  switch (kind) {
    case 'full':
      return [source];
    case 'whitespace':
      return source.split(/\s+/).filter((t) => t.length > 0);
    case 'delimiter':
      return source.split(/[\s,.\-/_]+/).filter((t) => t.length > 0);
  }
}

interface TokenCandidate {
  /** Source column index (0-based into the example.source array order). */
  sourceArrayIdx: number;
  /** Original column index in the sheet (used to populate sourceColumn on the step). */
  sourceColumn: number;
  /** Tokenization kind. */
  kind: TokenKind;
  /** Index into the tokenized source. */
  tokenIndex: number;
  /** The literal token text. */
  text: string;
}

const CASE_TRANSFORMS: CaseChangeType[] = ['none', 'lower', 'upper', 'title'];

/**
 * Detect a template pattern by greedy-matching the example output against
 * source-derived tokens, accumulating un-matched characters as literal
 * segments.
 *
 * Algorithm:
 * 1. Build a candidate set from each source column: the full value, each
 * whitespace-token, and each delimiter-token.
 * 2. Walk the example output left-to-right. At each position, pick the
 * longest candidate whose (case-transformed) text matches at the cursor.
 * 3. Anything not matched becomes part of a literal segment.
 * 4. Validate the resulting template against every example before returning.
 *
 * The detector uses examples[0] to derive the template; subsequent examples
 * are used purely for validation. This mirrors Excel: a single unambiguous
 * example is sufficient when every source token appears verbatim (modulo
 * case) in the output.
 */
function detectTemplatePattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  if (examples.length === 0) return null;

  // sourceColumns iterated in insertion order — the coordinator/handler put
  // closer columns first which is a sensible tie-break.
  const sourceColumns = Array.from(sourceData.keys());
  if (sourceColumns.length === 0) return null;

  const seedExample = examples[0];
  const seedSourceVals = sourceColumns.map((col) => {
    const colData = sourceData.get(col)!;
    const v = colData[seedExample.row - startRow];
    return v != null ? String(v) : '';
  });
  const seedOutput = seedExample.output != null ? String(seedExample.output) : '';
  if (seedOutput.length === 0) return null;

  const candidates = buildTokenCandidates(seedSourceVals, sourceColumns);
  if (candidates.length === 0) return null;

  const segments = synthesizeTemplate(seedOutput, candidates);
  if (!segments) return null;

  const apply = buildTemplateApplier(sourceColumns);

  // Validate the template against every example (including the seed).
  for (const ex of examples) {
    const exSourceVals = sourceColumns.map((col) => {
      const colData = sourceData.get(col)!;
      const v = colData[ex.row - startRow];
      return v != null ? String(v) : '';
    });
    const expected = ex.output != null ? String(ex.output) : '';
    const produced = apply(segments, exSourceVals);
    if (produced !== expected) return null;
  }

  // Determine which source columns the template actually references — a
  // source-column listing keeps the existing pattern API uniform.
  const usedColumns = new Set<number>();
  for (const seg of segments) {
    if (seg.type === 'token' && typeof seg.sourceColumn === 'number') {
      usedColumns.add(seg.sourceColumn);
    }
  }

  return {
    type: 'template',
    steps: segments,
    confidence: examples.length >= 2 ? 0.95 : 0.9,
    sourceColumns: Array.from(usedColumns).sort((a, b) => a - b),
    description: describeTemplate(segments),
  };
}

/**
 * Build the candidate token list used by the greedy matcher. We always
 * include all three tokenization kinds so that the matcher can pick the
 * longest match — this is what lets a single algorithm handle both
 * "Widget" (full/whitespace coincide) and "10234" from "INV-10234-Q1"
 * (only delimiter splits produce that token).
 */
function buildTokenCandidates(sourceVals: string[], sourceColumns: number[]): TokenCandidate[] {
  const out: TokenCandidate[] = [];
  for (let i = 0; i < sourceVals.length; i++) {
    const val = sourceVals[i];
    if (val.length === 0) continue;
    const sourceColumn = sourceColumns[i];

    // Full string
    out.push({
      sourceArrayIdx: i,
      sourceColumn,
      kind: 'full',
      tokenIndex: 0,
      text: val,
    });

    const wsTokens = tokenizeSource(val, 'whitespace');
    for (let j = 0; j < wsTokens.length; j++) {
      out.push({
        sourceArrayIdx: i,
        sourceColumn,
        kind: 'whitespace',
        tokenIndex: j,
        text: wsTokens[j],
      });
    }

    const dlTokens = tokenizeSource(val, 'delimiter');
    for (let j = 0; j < dlTokens.length; j++) {
      out.push({
        sourceArrayIdx: i,
        sourceColumn,
        kind: 'delimiter',
        tokenIndex: j,
        text: dlTokens[j],
      });
    }
  }
  return out;
}

/**
 * Greedy-match candidates against the output to produce a list of
 * literal/token segments. Returns `null` if the example output cannot be
 * fully reconstructed as a sequence of (case-transformed) candidate tokens
 * + literal characters — though in practice this never returns null (the
 * worst-case is a single literal segment matching the whole output, which
 * is almost never useful but is handled by the validation step).
 */
function synthesizeTemplate(
  output: string,
  candidates: TokenCandidate[],
): TransformationStep[] | null {
  const segments: TransformationStep[] = [];
  let literal = '';
  let i = 0;

  while (i < output.length) {
    const match = findBestMatchAt(output, i, candidates);
    if (match) {
      if (literal.length > 0) {
        segments.push({ type: 'literal', literal });
        literal = '';
      }
      segments.push({
        type: 'token',
        sourceColumn: match.candidate.sourceColumn,
        tokenKind: match.candidate.kind,
        tokenIndex: match.candidate.tokenIndex,
        caseChange: match.caseChange === 'none' ? undefined : match.caseChange,
        tokenPrefixLen: match.prefixLen ?? undefined,
      });
      i += match.length;
    } else {
      literal += output[i];
      i++;
    }
  }
  if (literal.length > 0) {
    segments.push({ type: 'literal', literal });
  }

  // A template that is pure-literal isn't useful — every row would get the
  // same constant string, which is what the buggy first-example detector did.
  // Reject so a less-greedy detector or the no-pattern path takes over.
  const hasToken = segments.some((s) => s.type === 'token');
  if (!hasToken) return null;
  return segments;
}

/**
 * At a given output position, find the best candidate (across all case
 * transforms and any matching prefix length) whose (transformed) text matches
 * the substring of `output` starting at `pos`.
 *
 * Considers two match modes:
 * - Full token match: the entire transformed token equals the substring.
 * - Prefix match: a leading slice of the transformed token equals the
 * substring (e.g., "J" matches the first char of "John").
 *
 * Full matches are always preferred over prefix matches at the same length.
 * Among matches of equal length, ties are broken by:
 * 1. Prefer full match over prefix match.
 * 2. Prefer no case change.
 * 3. Prefer 'full' tokenization > 'whitespace' > 'delimiter'.
 * 4. Prefer lower source array index (closer / earlier column).
 * 5. Prefer lower token index.
 * 6. Prefer longer prefix length (to lock in the canonical token boundary).
 */
interface MatchInfo {
  candidate: TokenCandidate;
  caseChange: CaseChangeType;
  length: number;
  /** When set, the match used only the first `length` chars of the token. */
  prefixLen: number | null;
}

function findBestMatchAt(
  output: string,
  pos: number,
  candidates: TokenCandidate[],
): MatchInfo | null {
  let best: MatchInfo | null = null;

  for (const c of candidates) {
    if (c.text.length === 0) continue;
    for (const ct of CASE_TRANSFORMS) {
      const transformed = applyCase(c.text, ct);
      if (transformed.length === 0) continue;

      // Full match
      if (
        pos + transformed.length <= output.length &&
        output.substr(pos, transformed.length) === transformed
      ) {
        const m: MatchInfo = {
          candidate: c,
          caseChange: ct,
          length: transformed.length,
          prefixLen: null,
        };
        if (!best || isBetterMatch(m, best)) best = m;
      } else {
        // Prefix match: longest k in [1..transformed.length-1] where
        // transformed.substring(0,k) === output.substr(pos,k).
        // Only tokenized source parts can be prefix-matched. Allowing the
        // whole source string to prefix-match causes over-broad templates such
        // as "North R" + "Territory" for "North Region" -> "North Territory".
        // Prefixing an actual token still covers Excel-style initials like
        // "John Smith" -> "J. Smith".
        if (c.kind === 'full') continue;
        const limit = Math.min(transformed.length - 1, output.length - pos);
        let k = 0;
        while (k < limit && output[pos + k] === transformed[k]) k++;
        if (k >= 1) {
          const m: MatchInfo = {
            candidate: c,
            caseChange: ct,
            length: k,
            prefixLen: k,
          };
          if (!best || isBetterMatch(m, best)) best = m;
        }
      }
    }
  }

  return best;
}

const KIND_PRIORITY: Record<TokenKind, number> = {
  full: 0,
  whitespace: 1,
  delimiter: 2,
};

function isBetterMatch(a: MatchInfo, b: MatchInfo): boolean {
  if (a.length !== b.length) return a.length > b.length;
  // Prefer full match over prefix match (more constrained, less chance of
  // accidental fits).
  const aFull = a.prefixLen == null ? 0 : 1;
  const bFull = b.prefixLen == null ? 0 : 1;
  if (aFull !== bFull) return aFull < bFull;
  // Prefer asis over case-changed (more "obvious" pattern).
  const aNone = a.caseChange === 'none' ? 0 : 1;
  const bNone = b.caseChange === 'none' ? 0 : 1;
  if (aNone !== bNone) return aNone < bNone;
  const aKind = KIND_PRIORITY[a.candidate.kind];
  const bKind = KIND_PRIORITY[b.candidate.kind];
  if (aKind !== bKind) return aKind < bKind;
  if (a.candidate.sourceArrayIdx !== b.candidate.sourceArrayIdx)
    return a.candidate.sourceArrayIdx < b.candidate.sourceArrayIdx;
  return a.candidate.tokenIndex < b.candidate.tokenIndex;
}

/**
 * Build a template applier bound to a specific `sourceColumns` iteration
 * order. Used for validating a synthesized template against subsequent
 * examples (the public `applyPattern` path used at fill time has its own
 * `case 'token'` handler that resolves sources via the row's sourceValues
 * array as ordered by `pattern.sourceColumns`).
 */
function buildTemplateApplier(
  sourceColumns: number[],
): (steps: TransformationStep[], sourceVals: string[]) => string {
  const colToIdx = new Map<number, number>();
  for (let i = 0; i < sourceColumns.length; i++) colToIdx.set(sourceColumns[i], i);

  return (steps, sourceVals) => {
    let result = '';
    for (const step of steps) {
      if (step.type === 'literal') {
        result += step.literal ?? '';
      } else if (step.type === 'token') {
        const idx = step.sourceColumn != null ? (colToIdx.get(step.sourceColumn) ?? -1) : 0;
        const sourceStr = idx >= 0 && idx < sourceVals.length ? sourceVals[idx] : '';
        const tokens = tokenizeSource(sourceStr, step.tokenKind ?? 'whitespace');
        const tok = tokens[step.tokenIndex ?? 0] ?? '';
        const cased = applyCase(tok, step.caseChange ?? 'none');
        result += step.tokenPrefixLen != null ? cased.substring(0, step.tokenPrefixLen) : cased;
      }
    }
    return result;
  };
}

/**
 * Build a short human-readable description of a template (shown in the
 * preview popup).
 */
function describeTemplate(steps: TransformationStep[]): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === 'literal') {
      parts.push(JSON.stringify(s.literal ?? ''));
    } else if (s.type === 'token') {
      const kind = s.tokenKind ?? 'whitespace';
      const cs = s.caseChange && s.caseChange !== 'none' ? ` ${s.caseChange}` : '';
      parts.push(`<col${s.sourceColumn}.${kind}[${s.tokenIndex ?? 0}]${cs}>`);
    }
  }
  return `Template: ${parts.join(' + ')}`;
}

// =============================================================================
// Pattern Detection Functions
// =============================================================================

/**
 * Detect extraction pattern (extracting substring from source).
 */
function detectExtractionPattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  // For each source column, check if output is a substring
  for (const [colIdx, colData] of sourceData.entries()) {
    const pattern = tryExtractionFromColumn(examples, colData, colIdx, startRow);
    if (pattern) return pattern;
  }
  return null;
}

/**
 * Try to detect extraction pattern from a specific source column.
 */
function tryExtractionFromColumn(
  examples: FlashFillExample[],
  sourceColData: CellValue[],
  colIdx: number,
  startRow: number,
): FlashFillPattern | null {
  // Check if outputs are substrings of sources
  const extractionInfos: Array<{
    start: number;
    length: number;
    sourceStr: string;
    outputStr: string;
  }> = [];

  for (const example of examples) {
    // Fix: Use relative index (example.row - startRow) since sourceColData is 0-indexed
    const sourceVal = sourceColData[example.row - startRow];
    const sourceStr = sourceVal != null ? String(sourceVal) : '';
    const outputStr = example.output != null ? String(example.output) : '';

    if (outputStr === '') continue;

    const startIdx = sourceStr.indexOf(outputStr);
    if (startIdx === -1) return null;

    extractionInfos.push({
      start: startIdx,
      length: outputStr.length,
      sourceStr,
      outputStr,
    });
  }

  if (extractionInfos.length === 0) return null;

  // Check if all extractions follow the same pattern
  const first = extractionInfos[0];

  // Try position-based extraction (same start position)
  const allSameStart = extractionInfos.every((info) => info.start === first.start);
  if (allSameStart) {
    return {
      type: 'extract',
      steps: [
        {
          type: 'extract_position',
          position: {
            start: first.start,
            length: first.length,
          },
          sourceColumn: colIdx,
        },
      ],
      confidence: 0.9,
      sourceColumns: [colIdx],
      description: `Extract characters ${first.start + 1} to ${first.start + first.length}`,
    };
  }

  // Try word-based extraction (find common word patterns)
  const wordPattern = tryWordExtractionPattern(examples, sourceColData, colIdx, startRow);
  if (wordPattern) return wordPattern;

  return null;
}

/**
 * Try to detect word-based extraction pattern.
 */
function tryWordExtractionPattern(
  examples: FlashFillExample[],
  sourceColData: CellValue[],
  colIdx: number,
  startRow: number,
): FlashFillPattern | null {
  const wordIndices: number[] = [];

  for (const example of examples) {
    // Fix: Use relative index (example.row - startRow) since sourceColData is 0-indexed
    const sourceVal = sourceColData[example.row - startRow];
    const sourceStr = sourceVal != null ? String(sourceVal) : '';
    const outputStr = example.output != null ? String(example.output) : '';

    // Split by common delimiters
    const words = sourceStr.split(/[\s,.-]+/);
    const wordIdx = words.findIndex((w) => w === outputStr);

    if (wordIdx === -1) return null;
    wordIndices.push(wordIdx);
  }

  // Check if all examples use the same word index
  if (wordIndices.length > 0 && wordIndices.every((idx) => idx === wordIndices[0])) {
    return {
      type: 'extract',
      steps: [
        {
          type: 'extract_word',
          wordIndex: wordIndices[0],
          sourceColumn: colIdx,
        },
      ],
      confidence: 0.85,
      sourceColumns: [colIdx],
      description: `Extract word ${wordIndices[0] + 1}`,
    };
  }

  return null;
}

/**
 * Detect case change pattern.
 */
function detectCaseChangePattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  for (const [colIdx, colData] of sourceData.entries()) {
    // Check if output is a case transformation of source
    let caseType: 'upper' | 'lower' | 'title' | null = null;
    let allMatch = true;

    for (const example of examples) {
      // Fix: Use relative index (example.row - startRow) since colData is 0-indexed
      const sourceVal = colData[example.row - startRow];
      const sourceStr = sourceVal != null ? String(sourceVal) : '';
      const outputStr = example.output != null ? String(example.output) : '';

      if (outputStr === sourceStr.toUpperCase()) {
        if (caseType === null) caseType = 'upper';
        else if (caseType !== 'upper') allMatch = false;
      } else if (outputStr === sourceStr.toLowerCase()) {
        if (caseType === null) caseType = 'lower';
        else if (caseType !== 'lower') allMatch = false;
      } else if (outputStr === toTitleCase(sourceStr)) {
        if (caseType === null) caseType = 'title';
        else if (caseType !== 'title') allMatch = false;
      } else {
        allMatch = false;
      }

      if (!allMatch) break;
    }

    if (allMatch && caseType) {
      return {
        type: 'case_change',
        steps: [
          {
            type: 'case_change',
            caseChange: caseType,
            sourceColumn: colIdx,
          },
        ],
        confidence: 0.95,
        sourceColumns: [colIdx],
        description: `Change to ${caseType} case`,
      };
    }
  }

  return null;
}

/**
 * Detect combine pattern (combining multiple columns).
 */
function detectCombinePattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  if (sourceData.size < 2) return null;

  // Look for patterns where output combines values from multiple columns
  // with potential separators
  const sourceColumns = Array.from(sourceData.keys()).sort((a, b) => a - b);

  // Try common separator patterns
  const separators = [' ', ', ', '-', '_', ''];

  for (const sep of separators) {
    const pattern = tryCombineWithSeparator(examples, sourceData, sourceColumns, sep, startRow);
    if (pattern) return pattern;
  }

  return null;
}

/**
 * Try combining columns with a specific separator.
 */
function tryCombineWithSeparator(
  examples: FlashFillExample[],
  sourceData: Map<number, CellValue[]>,
  sourceColumns: number[],
  separator: string,
  startRow: number,
): FlashFillPattern | null {
  // Try different column orderings
  const orderings = getColumnOrderings(sourceColumns, 2);

  for (const ordering of orderings) {
    let allMatch = true;

    for (const example of examples) {
      const parts = ordering.map((colIdx) => {
        const colData = sourceData.get(colIdx)!;
        // Fix: Use relative index (example.row - startRow) since colData is 0-indexed
        const val = colData[example.row - startRow];
        return val != null ? String(val) : '';
      });

      const combined = parts.join(separator);
      const outputStr = example.output != null ? String(example.output) : '';

      if (combined !== outputStr) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      const steps: TransformationStep[] = [];
      ordering.forEach((colIdx, idx) => {
        if (idx > 0 && separator) {
          steps.push({ type: 'literal', literal: separator });
        }
        steps.push({
          type: 'extract_position',
          position: { start: 0, length: -1 },
          sourceColumn: colIdx,
        });
      });

      return {
        type: 'combine',
        steps,
        confidence: 0.85,
        sourceColumns: ordering,
        description: `Combine columns${separator ? ` with "${separator}"` : ''}`,
      };
    }
  }

  return null;
}

/**
 * Detect split pattern (splitting by delimiter).
 */
function detectSplitPattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  const delimiters = [' ', ', ', '-', '_', '/'];

  for (const [colIdx, colData] of sourceData.entries()) {
    for (const delimiter of delimiters) {
      let wordIndex: number | null = null;
      let allMatch = true;

      for (const example of examples) {
        // Fix: Use relative index (example.row - startRow) since colData is 0-indexed
        const sourceVal = colData[example.row - startRow];
        const sourceStr = sourceVal != null ? String(sourceVal) : '';
        const outputStr = example.output != null ? String(example.output) : '';

        const parts = sourceStr.split(delimiter);
        const idx = parts.findIndex((p) => p === outputStr);

        if (idx === -1) {
          allMatch = false;
          break;
        }

        if (wordIndex === null) wordIndex = idx;
        else if (wordIndex !== idx) {
          allMatch = false;
          break;
        }
      }

      if (allMatch && wordIndex !== null) {
        return {
          type: 'split',
          steps: [
            {
              type: 'extract_delimiter',
              delimiter,
              wordIndex,
              sourceColumn: colIdx,
            },
          ],
          confidence: 0.9,
          sourceColumns: [colIdx],
          description: `Split by "${delimiter}" and take part ${wordIndex + 1}`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect prefix/suffix pattern.
 */
function detectPrefixSuffixPattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  for (const [colIdx, colData] of sourceData.entries()) {
    // Check for prefix pattern
    let prefix: string | null = null;
    let suffix: string | null = null;
    let allMatchPrefix = true;
    let allMatchSuffix = true;

    for (const example of examples) {
      // Fix: Use relative index (example.row - startRow) since colData is 0-indexed
      const sourceVal = colData[example.row - startRow];
      const sourceStr = sourceVal != null ? String(sourceVal) : '';
      const outputStr = example.output != null ? String(example.output) : '';

      // Check if output starts with something + source
      if (outputStr.endsWith(sourceStr)) {
        const pre = outputStr.slice(0, outputStr.length - sourceStr.length);
        if (prefix === null) prefix = pre;
        else if (prefix !== pre) allMatchPrefix = false;
      } else {
        allMatchPrefix = false;
      }

      // Check if output ends with source + something
      if (outputStr.startsWith(sourceStr)) {
        const suf = outputStr.slice(sourceStr.length);
        if (suffix === null) suffix = suf;
        else if (suffix !== suf) allMatchSuffix = false;
      } else {
        allMatchSuffix = false;
      }
    }

    if (allMatchPrefix && prefix) {
      return {
        type: 'prefix',
        steps: [
          { type: 'literal', literal: prefix },
          { type: 'extract_position', position: { start: 0, length: -1 }, sourceColumn: colIdx },
        ],
        confidence: 0.9,
        sourceColumns: [colIdx],
        description: `Add prefix "${prefix}"`,
      };
    }

    if (allMatchSuffix && suffix) {
      return {
        type: 'suffix',
        steps: [
          { type: 'extract_position', position: { start: 0, length: -1 }, sourceColumn: colIdx },
          { type: 'literal', literal: suffix },
        ],
        confidence: 0.9,
        sourceColumns: [colIdx],
        description: `Add suffix "${suffix}"`,
      };
    }
  }

  return null;
}

/**
 * Detect replace pattern.
 */
function detectReplacePattern(context: FlashFillContext): FlashFillPattern | null {
  const { examples, sourceData, startRow } = context;
  for (const [colIdx, colData] of sourceData.entries()) {
    // Try to find a common replacement pattern
    const replacements: Array<{ from: string; to: string }> = [];

    for (const example of examples) {
      // Fix: Use relative index (example.row - startRow) since colData is 0-indexed
      const sourceVal = colData[example.row - startRow];
      const sourceStr = sourceVal != null ? String(sourceVal) : '';
      const outputStr = example.output != null ? String(example.output) : '';

      // Find the difference between source and output
      const diff = findStringDifference(sourceStr, outputStr);
      if (diff) {
        replacements.push(diff);
      } else if (sourceStr !== outputStr) {
        // No clear replacement pattern found
        break;
      }
    }

    // Check if all replacements are consistent
    if (
      replacements.length === examples.length &&
      replacements.every((r) => r.from === replacements[0].from && r.to === replacements[0].to)
    ) {
      return {
        type: 'replace',
        steps: [
          {
            type: 'replace',
            replace: replacements[0],
            sourceColumn: colIdx,
          },
        ],
        confidence: 0.85,
        sourceColumns: [colIdx],
        description: `Replace "${replacements[0].from}" with "${replacements[0].to}"`,
      };
    }
  }

  return null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate values for all rows using a pattern.
 */
function generateValues(
  pattern: FlashFillPattern,
  sourceData: Map<number, CellValue[]>,
  startRow: number,
  endRow: number,
  examples: FlashFillExample[],
): CellValue[] {
  const exampleRows = new Set(examples.map((e) => e.row));
  const values: CellValue[] = [];

  for (let row = startRow; row <= endRow; row++) {
    // Skip example rows (keep user's values)
    if (exampleRows.has(row)) {
      const example = examples.find((e) => e.row === row);
      values.push(example?.output ?? '');
      continue;
    }

    // Gather source values for this row
    // Fix: Use relative index (row - startRow) since colData is 0-indexed
    const sourceValues: CellValue[] = pattern.sourceColumns.map((colIdx) => {
      const colData = sourceData.get(colIdx);
      return colData?.[row - startRow] ?? '';
    });

    values.push(applyPattern(pattern, sourceValues));
  }

  return values;
}

/**
 * Get rows that were filled (excluding example rows).
 */
function getFilledRows(startRow: number, endRow: number, examples: FlashFillExample[]): number[] {
  const exampleRows = new Set(examples.map((e) => e.row));
  const filled: number[] = [];

  for (let row = startRow; row <= endRow; row++) {
    if (!exampleRows.has(row)) {
      filled.push(row);
    }
  }

  return filled;
}

/**
 * Extract substring by position.
 */
function extractByPosition(source: string, position: { start: number; length: number }): string {
  const start = position.start < 0 ? source.length + position.start : position.start;
  const length = position.length === -1 ? source.length - start : position.length;
  return source.substring(start, start + length);
}

/**
 * Extract by delimiter.
 */
function extractByDelimiter(source: string, delimiter: string, wordIndex: number): string {
  const parts = source.split(delimiter);
  return parts[wordIndex] ?? '';
}

/**
 * Extract word by index (splitting by whitespace and punctuation).
 */
function extractWord(source: string, wordIndex: number): string {
  const words = source.split(/[\s,.-]+/);
  return words[wordIndex] ?? '';
}

/**
 * Apply case transformation.
 */
function applyCase(
  source: string,
  caseType: 'upper' | 'lower' | 'title' | 'sentence' | 'none',
): string {
  switch (caseType) {
    case 'upper':
      return source.toUpperCase();
    case 'lower':
      return source.toLowerCase();
    case 'title':
      return toTitleCase(source);
    case 'sentence':
      return source.charAt(0).toUpperCase() + source.slice(1).toLowerCase();
    case 'none':
    default:
      return source;
  }
}

/**
 * Convert to title case.
 */
function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

/**
 * Find the difference between two strings (simple replacement).
 */
function findStringDifference(source: string, target: string): { from: string; to: string } | null {
  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < source.length &&
    prefixLen < target.length &&
    source[prefixLen] === target[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix
  let suffixLen = 0;
  while (
    suffixLen < source.length - prefixLen &&
    suffixLen < target.length - prefixLen &&
    source[source.length - 1 - suffixLen] === target[target.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const from = source.substring(prefixLen, source.length - suffixLen);
  const to = target.substring(prefixLen, target.length - suffixLen);

  if (from || to) {
    return { from, to };
  }

  return null;
}

/**
 * Get column orderings up to a certain size.
 */
function getColumnOrderings(columns: number[], maxSize: number): number[][] {
  const orderings: number[][] = [];

  // Generate permutations of length 2 to maxSize
  for (let size = 2; size <= Math.min(maxSize, columns.length); size++) {
    const perms = getPermutations(columns, size);
    orderings.push(...perms);
  }

  return orderings;
}

/**
 * Get permutations of an array.
 */
function getPermutations<T>(arr: T[], size: number): T[][] {
  if (size === 1) return arr.map((x) => [x]);

  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const perms = getPermutations(rest, size - 1);
    for (const perm of perms) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}
