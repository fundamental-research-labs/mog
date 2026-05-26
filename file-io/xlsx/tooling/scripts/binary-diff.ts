#!/usr/bin/env npx tsx
/**
 * Binary Diff Analysis Script for XLSX Round-Trip Verification
 *
 * Compares XLSX files before and after round-trip processing to identify:
 * - Acceptable differences (whitespace, attribute order, namespace prefixes)
 * - Unexpected differences that may indicate data loss
 * - XML part-by-part comparison with detailed diff output
 *
 * Usage:
 *   npx tsx xlsx/tooling/scripts/binary-diff.ts <original.xlsx> <roundtrip.xlsx>
 *   npx tsx xlsx/tooling/scripts/binary-diff.ts --generate <input.xlsx> <output.xlsx>
 *   npx tsx xlsx/tooling/scripts/binary-diff.ts --verbose <original.xlsx> <roundtrip.xlsx>
 *
 * Options:
 *   --generate    Generate a round-tripped version of the input file
 *   --verbose     Show detailed diffs for each XML part
 *   --json        Output results as JSON
 *   --ignore-ws   Ignore whitespace differences (default: true)
 *   --help        Show this help message
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import JSZip from 'jszip';

// =============================================================================
// Types
// =============================================================================

interface DiffResult {
  /** Original file path */
  originalPath: string;
  /** Round-tripped file path */
  roundtripPath: string;
  /** Overall comparison result */
  result: 'identical' | 'acceptable' | 'different';
  /** Summary of differences */
  summary: {
    totalParts: number;
    identicalParts: number;
    acceptableDiffs: number;
    unexpectedDiffs: number;
    missingParts: string[];
    extraParts: string[];
  };
  /** Per-part comparison results */
  parts: PartDiff[];
  /** Timestamp of analysis */
  timestamp: string;
}

interface PartDiff {
  /** Part path within the ZIP */
  path: string;
  /** Comparison result for this part */
  result: 'identical' | 'acceptable' | 'different' | 'missing' | 'extra';
  /** Type of content */
  contentType: 'xml' | 'binary' | 'relationship' | 'unknown';
  /** Original content size (bytes) */
  originalSize?: number;
  /** Roundtrip content size (bytes) */
  roundtripSize?: number;
  /** Detected differences */
  differences?: PartDifference[];
}

interface PartDifference {
  /** Type of difference */
  type:
    | 'whitespace'
    | 'attribute_order'
    | 'namespace_prefix'
    | 'element_order'
    | 'content'
    | 'missing'
    | 'extra';
  /** Description of the difference */
  description: string;
  /** Whether this difference is acceptable */
  acceptable: boolean;
  /** Location in the XML (if applicable) */
  location?: string;
  /** Original value */
  original?: string;
  /** Round-tripped value */
  roundtrip?: string;
}

interface Options {
  verbose: boolean;
  json: boolean;
  ignoreWhitespace: boolean;
  generate: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Known XLSX content types for XML parts */
const XML_CONTENT_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  'application/vnd.openxmlformats-officedocument.theme+xml',
  'application/vnd.openxmlformats-package.core-properties+xml',
  'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  'application/vnd.openxmlformats-package.relationships+xml',
]);

/** Parts that are acceptable to have differences in */
const ACCEPTABLE_DIFF_PARTS = new Set([
  '[Content_Types].xml', // Order may vary
  'docProps/core.xml', // Timestamps change
  'docProps/app.xml', // Application info changes
]);

/** XML elements where attribute order doesn't matter */
const UNORDERED_ATTRIBUTE_ELEMENTS = new Set([
  'worksheet',
  'workbook',
  'styleSheet',
  'sst',
  'Types',
  'Override',
  'Default',
  'Relationship',
]);

// =============================================================================
// XML Parsing and Comparison
// =============================================================================

/**
 * Normalize XML content for comparison
 */
function normalizeXml(xml: string, ignoreWhitespace: boolean): string {
  let normalized = xml;

  if (ignoreWhitespace) {
    // Remove extra whitespace between tags
    normalized = normalized.replace(/>\s+</g, '><');
    // Normalize line endings
    normalized = normalized.replace(/\r\n/g, '\n');
    // Remove trailing whitespace
    normalized = normalized.replace(/[ \t]+$/gm, '');
  }

  // Normalize XML declaration
  normalized = normalized.replace(/\s*\?>/g, '?>');

  return normalized.trim();
}

/**
 * Extract and sort attributes from an XML tag
 */
function extractAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRegex = /(\w+(?::\w+)?)\s*=\s*["']([^"']*)["']/g;
  let match;

  while ((match = attrRegex.exec(tag)) !== null) {
    attrs.set(match[1], match[2]);
  }

  return attrs;
}

/**
 * Compare two XML strings and identify differences
 */
function compareXml(
  original: string,
  roundtrip: string,
  ignoreWhitespace: boolean,
): PartDifference[] {
  const differences: PartDifference[] = [];

  const normalizedOriginal = normalizeXml(original, ignoreWhitespace);
  const normalizedRoundtrip = normalizeXml(roundtrip, ignoreWhitespace);

  if (normalizedOriginal === normalizedRoundtrip) {
    return differences;
  }

  // Check for whitespace-only differences
  if (normalizeXml(original, true) === normalizeXml(roundtrip, true)) {
    differences.push({
      type: 'whitespace',
      description: 'Only whitespace differences found',
      acceptable: true,
    });
    return differences;
  }

  // Split into elements for more detailed comparison
  const originalElements = normalizedOriginal.match(/<[^>]+>/g) || [];
  const roundtripElements = normalizedRoundtrip.match(/<[^>]+>/g) || [];

  // Compare element counts
  if (originalElements.length !== roundtripElements.length) {
    differences.push({
      type: 'content',
      description: `Element count differs: ${originalElements.length} vs ${roundtripElements.length}`,
      acceptable: false,
    });
  }

  // Check for attribute order differences in matching elements
  const minElements = Math.min(originalElements.length, roundtripElements.length);
  for (let i = 0; i < minElements; i++) {
    const origElem = originalElements[i];
    const rtElem = roundtripElements[i];

    if (origElem === rtElem) continue;

    // Extract tag name
    const origTagMatch = origElem.match(/^<\/?(\w+(?::\w+)?)/);
    const rtTagMatch = rtElem.match(/^<\/?(\w+(?::\w+)?)/);

    if (!origTagMatch || !rtTagMatch) continue;

    if (origTagMatch[1] !== rtTagMatch[1]) {
      differences.push({
        type: 'content',
        description: `Element tag differs at position ${i}`,
        acceptable: false,
        original: origElem.substring(0, 100),
        roundtrip: rtElem.substring(0, 100),
      });
      continue;
    }

    // Compare attributes
    const origAttrs = extractAttributes(origElem);
    const rtAttrs = extractAttributes(rtElem);

    // Check if attributes are the same (ignoring order)
    let attrsDiffer = false;
    for (const [key, value] of origAttrs) {
      if (rtAttrs.get(key) !== value) {
        attrsDiffer = true;
        differences.push({
          type: 'content',
          description: `Attribute "${key}" differs in element ${origTagMatch[1]}`,
          acceptable: false,
          original: value,
          roundtrip: rtAttrs.get(key) || '(missing)',
        });
      }
    }

    // Check for extra attributes in roundtrip
    for (const key of rtAttrs.keys()) {
      if (!origAttrs.has(key)) {
        differences.push({
          type: 'extra',
          description: `Extra attribute "${key}" in roundtrip element ${origTagMatch[1]}`,
          acceptable: false,
          roundtrip: rtAttrs.get(key),
        });
      }
    }

    // If only attribute order differs, mark as acceptable
    if (!attrsDiffer && origAttrs.size === rtAttrs.size) {
      // Check if it's just attribute order
      const sortedOrig = [...origAttrs.entries()].sort().toString();
      const sortedRt = [...rtAttrs.entries()].sort().toString();

      if (sortedOrig === sortedRt) {
        differences.push({
          type: 'attribute_order',
          description: `Attribute order differs in element ${origTagMatch[1]}`,
          acceptable: true,
          location: `Element ${i}`,
        });
      }
    }
  }

  // If no specific differences found but content differs
  if (differences.length === 0) {
    differences.push({
      type: 'content',
      description: 'Content differs but specific differences not identified',
      acceptable: false,
      original: normalizedOriginal.substring(0, 200),
      roundtrip: normalizedRoundtrip.substring(0, 200),
    });
  }

  return differences;
}

/**
 * Compare binary content
 */
function compareBinary(original: Uint8Array, roundtrip: Uint8Array): PartDifference[] {
  const differences: PartDifference[] = [];

  if (original.length !== roundtrip.length) {
    differences.push({
      type: 'content',
      description: `Size differs: ${original.length} vs ${roundtrip.length} bytes`,
      acceptable: false,
    });
    return differences;
  }

  // Compare bytes
  let diffCount = 0;
  let firstDiffPos = -1;

  for (let i = 0; i < original.length; i++) {
    if (original[i] !== roundtrip[i]) {
      diffCount++;
      if (firstDiffPos === -1) {
        firstDiffPos = i;
      }
    }
  }

  if (diffCount > 0) {
    differences.push({
      type: 'content',
      description: `${diffCount} byte differences found, first at position ${firstDiffPos}`,
      acceptable: false,
    });
  }

  return differences;
}

// =============================================================================
// XLSX Processing
// =============================================================================

/**
 * Determine content type of a part
 */
function getContentType(path: string): 'xml' | 'binary' | 'relationship' | 'unknown' {
  if (path.endsWith('.xml')) return 'xml';
  if (path.endsWith('.rels')) return 'relationship';
  if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'binary';
  if (path.endsWith('.bin')) return 'binary';
  return 'unknown';
}

/**
 * Compare two XLSX files
 */
async function compareXlsxFiles(
  originalPath: string,
  roundtripPath: string,
  options: Options,
): Promise<DiffResult> {
  const originalBuffer = readFileSync(originalPath);
  const roundtripBuffer = readFileSync(roundtripPath);

  const originalZip = await JSZip.loadAsync(originalBuffer);
  const roundtripZip = await JSZip.loadAsync(roundtripBuffer);

  const originalParts = Object.keys(originalZip.files).filter((p) => !originalZip.files[p].dir);
  const roundtripParts = Object.keys(roundtripZip.files).filter((p) => !roundtripZip.files[p].dir);

  const allParts = new Set([...originalParts, ...roundtripParts]);
  const partDiffs: PartDiff[] = [];

  let identicalParts = 0;
  let acceptableDiffs = 0;
  let unexpectedDiffs = 0;
  const missingParts: string[] = [];
  const extraParts: string[] = [];

  for (const partPath of allParts) {
    const inOriginal = originalParts.includes(partPath);
    const inRoundtrip = roundtripParts.includes(partPath);
    const contentType = getContentType(partPath);

    if (!inOriginal) {
      extraParts.push(partPath);
      partDiffs.push({
        path: partPath,
        result: 'extra',
        contentType,
        roundtripSize: (await roundtripZip.files[partPath].async('uint8array')).length,
      });
      continue;
    }

    if (!inRoundtrip) {
      missingParts.push(partPath);
      partDiffs.push({
        path: partPath,
        result: 'missing',
        contentType,
        originalSize: (await originalZip.files[partPath].async('uint8array')).length,
      });
      continue;
    }

    const originalContent = await originalZip.files[partPath].async('uint8array');
    const roundtripContent = await roundtripZip.files[partPath].async('uint8array');

    let differences: PartDifference[] = [];

    if (contentType === 'xml' || contentType === 'relationship') {
      const originalXml = new TextDecoder().decode(originalContent);
      const roundtripXml = new TextDecoder().decode(roundtripContent);
      differences = compareXml(originalXml, roundtripXml, options.ignoreWhitespace);
    } else if (contentType === 'binary') {
      differences = compareBinary(originalContent, roundtripContent);
    } else {
      // Unknown type - binary comparison
      differences = compareBinary(originalContent, roundtripContent);
    }

    // Determine result
    let result: 'identical' | 'acceptable' | 'different';
    if (differences.length === 0) {
      result = 'identical';
      identicalParts++;
    } else if (differences.every((d) => d.acceptable) || ACCEPTABLE_DIFF_PARTS.has(partPath)) {
      result = 'acceptable';
      acceptableDiffs++;
    } else {
      result = 'different';
      unexpectedDiffs++;
    }

    partDiffs.push({
      path: partPath,
      result,
      contentType,
      originalSize: originalContent.length,
      roundtripSize: roundtripContent.length,
      differences: differences.length > 0 ? differences : undefined,
    });
  }

  // Determine overall result
  let overallResult: 'identical' | 'acceptable' | 'different';
  if (unexpectedDiffs === 0 && missingParts.length === 0 && acceptableDiffs === 0) {
    overallResult = 'identical';
  } else if (unexpectedDiffs === 0 && missingParts.length === 0) {
    overallResult = 'acceptable';
  } else {
    overallResult = 'different';
  }

  return {
    originalPath,
    roundtripPath,
    result: overallResult,
    summary: {
      totalParts: allParts.size,
      identicalParts,
      acceptableDiffs,
      unexpectedDiffs,
      missingParts,
      extraParts,
    },
    parts: partDiffs,
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format diff result for console output
 */
function formatDiffResult(result: DiffResult, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('XLSX Binary Diff Analysis');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Original:    ${result.originalPath}`);
  lines.push(`Roundtrip:   ${result.roundtripPath}`);
  lines.push(`Timestamp:   ${result.timestamp}`);
  lines.push('');

  // Overall result with color indicators
  const resultIcon =
    result.result === 'identical' ? '[OK]' : result.result === 'acceptable' ? '[~]' : '[X]';
  lines.push(`Result: ${resultIcon} ${result.result.toUpperCase()}`);
  lines.push('');

  // Summary
  lines.push('Summary:');
  lines.push(`  Total parts:       ${result.summary.totalParts}`);
  lines.push(`  Identical parts:   ${result.summary.identicalParts}`);
  lines.push(`  Acceptable diffs:  ${result.summary.acceptableDiffs}`);
  lines.push(`  Unexpected diffs:  ${result.summary.unexpectedDiffs}`);

  if (result.summary.missingParts.length > 0) {
    lines.push(`  Missing parts:     ${result.summary.missingParts.length}`);
    for (const part of result.summary.missingParts) {
      lines.push(`    - ${part}`);
    }
  }

  if (result.summary.extraParts.length > 0) {
    lines.push(`  Extra parts:       ${result.summary.extraParts.length}`);
    for (const part of result.summary.extraParts) {
      lines.push(`    - ${part}`);
    }
  }

  lines.push('');

  // Part details
  if (verbose || result.result === 'different') {
    lines.push('-'.repeat(80));
    lines.push('Part Details:');
    lines.push('-'.repeat(80));

    for (const part of result.parts) {
      if (!verbose && part.result === 'identical') continue;

      const icon =
        part.result === 'identical'
          ? '  '
          : part.result === 'acceptable'
            ? '~ '
            : part.result === 'different'
              ? 'X '
              : '? ';

      lines.push(`${icon}${part.path} [${part.result}]`);

      if (part.differences && (verbose || part.result !== 'acceptable')) {
        for (const diff of part.differences) {
          const acceptable = diff.acceptable ? '(acceptable)' : '(UNEXPECTED)';
          lines.push(`    - [${diff.type}] ${diff.description} ${acceptable}`);
          if (diff.original) {
            lines.push(`      Original:  ${diff.original.substring(0, 60)}...`);
          }
          if (diff.roundtrip) {
            lines.push(`      Roundtrip: ${diff.roundtrip.substring(0, 60)}...`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Round-trip Generation
// =============================================================================

/**
 * Generate a round-tripped XLSX file using the file-io module
 */
async function generateRoundtrip(inputPath: string, outputPath: string): Promise<void> {
  // Dynamic import of file-io module
  // @ts-expect-error file-io package not available in this workspace
  const fileIo = await import('../../file-io/src/index');

  const inputBuffer = readFileSync(inputPath);
  const importStore = fileIo.createMemoryStore();

  // Import
  const importResult = await fileIo.importFromXlsx(inputBuffer.buffer, importStore);
  if (!importResult.success) {
    throw new Error(`Import failed: ${importResult.error?.message ?? 'Unknown error'}`);
  }

  // Create exportable store from import store

  const exportStore: any = {
    getSheetOrder: () => importResult.sheetIds,

    getSheetMeta: (sheetId: string) => {
      const sheet = importStore.sheets.get(sheetId);
      if (!sheet) return undefined;
      return {
        id: sheetId,
        name: sheet.name,
        frozenRows: sheet.frozenRows ?? 0,
        frozenCols: sheet.frozenCols ?? 0,
      };
    },

    forEachCell: (sheetId: string, callback: (row: number, col: number, data: unknown) => void) => {
      const sheet = importStore.sheets.get(sheetId);
      if (!sheet) return;
      for (const [key, cell] of sheet.cells) {
        const [row, col] = key.split(',').map(Number);
        callback(row, col, {
          raw: cell.value,
          computed: cell.value,
        });
      }
    },

    getCellFormat: (sheetId: string, row: number, col: number) => {
      const sheet = importStore.sheets.get(sheetId);
      if (!sheet) return undefined;
      return sheet.cells.get(`${row},${col}`)?.format;
    },

    getRowHeight: (sheetId: string, row: number) => {
      const sheet = importStore.sheets.get(sheetId);
      return sheet?.rowHeights.get(row) ?? 21;
    },

    getColWidth: (sheetId: string, col: number) => {
      const sheet = importStore.sheets.get(sheetId);
      return sheet?.colWidths.get(col) ?? 100;
    },
  };

  // Export
  const exportResult = await fileIo.exportToXlsx(exportStore);
  if (!exportResult.success || !exportResult.buffer) {
    throw new Error(`Export failed`);
  }

  writeFileSync(outputPath, Buffer.from(exportResult.buffer));
  console.log(`Generated round-tripped file: ${outputPath}`);
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
XLSX Binary Diff Analysis Tool

Usage:
  npx tsx xlsx/tooling/scripts/binary-diff.ts <original.xlsx> <roundtrip.xlsx>
  npx tsx xlsx/tooling/scripts/binary-diff.ts --generate <input.xlsx> <output.xlsx>
  npx tsx xlsx/tooling/scripts/binary-diff.ts --verbose <original.xlsx> <roundtrip.xlsx>

Options:
  --generate    Generate a round-tripped version of the input file
  --verbose     Show detailed diffs for each XML part
  --json        Output results as JSON
  --ignore-ws   Ignore whitespace differences (default: true)
  --help        Show this help message

Examples:
  # Compare original with round-tripped file
  npx tsx xlsx/tooling/scripts/binary-diff.ts sample.xlsx sample-roundtrip.xlsx

  # Generate round-tripped version and compare
  npx tsx xlsx/tooling/scripts/binary-diff.ts --generate sample.xlsx sample-rt.xlsx
  npx tsx xlsx/tooling/scripts/binary-diff.ts sample.xlsx sample-rt.xlsx

  # Verbose output with JSON format
  npx tsx xlsx/tooling/scripts/binary-diff.ts --verbose --json sample.xlsx sample-rt.xlsx
`);
    process.exit(0);
  }

  const options: Options = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    json: args.includes('--json'),
    ignoreWhitespace: !args.includes('--no-ignore-ws'),
    generate: args.includes('--generate'),
  };

  // Filter out options to get file paths
  const filePaths = args.filter((a) => !a.startsWith('-'));

  if (options.generate) {
    if (filePaths.length < 2) {
      console.error('Error: --generate requires input and output file paths');
      process.exit(1);
    }

    const [inputPath, outputPath] = filePaths;

    if (!existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }

    await generateRoundtrip(inputPath, outputPath);
    console.log('Round-trip generation complete.');
    return;
  }

  if (filePaths.length < 2) {
    console.error('Error: Please provide two XLSX files to compare');
    process.exit(1);
  }

  const [originalPath, roundtripPath] = filePaths;

  if (!existsSync(originalPath)) {
    console.error(`Error: Original file not found: ${originalPath}`);
    process.exit(1);
  }

  if (!existsSync(roundtripPath)) {
    console.error(`Error: Roundtrip file not found: ${roundtripPath}`);
    process.exit(1);
  }

  const result = await compareXlsxFiles(originalPath, roundtripPath, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDiffResult(result, options.verbose));
  }

  // Exit with error code if differences found
  process.exit(result.result === 'different' ? 1 : 0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
