#!/usr/bin/env npx tsx
/**
 * Corpus Validation Script (5C-4)
 *
 * Validates all test files in the corpus:
 * - Parsed without crashing (in all modes: strict, lenient, permissive)
 * - Round-tripped (parse -> write -> parse) where applicable
 * - Generates a coverage report
 *
 * Usage: npx tsx scripts/validate-corpus.ts
 */

import * as fs from 'fs';
import JSZip from 'jszip';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const CORPUS_DIR = path.join(__dirname, '../test-corpus');
const REPORT_PATH = path.join(__dirname, '../test-corpus/validation-report.json');

type ParserMode = 'strict' | 'lenient' | 'permissive';

interface ValidationResult {
  file: string;
  relativePath: string;
  category: string;
  fileSize: number;
  results: {
    strict: ModeResult;
    lenient: ModeResult;
    permissive: ModeResult;
  };
  roundTrip?: RoundTripResult;
}

interface ModeResult {
  success: boolean;
  parseTimeMs: number;
  cellCount?: number;
  sheetCount?: number;
  errorCount?: number;
  error?: string;
  warnings?: string[];
}

interface RoundTripResult {
  success: boolean;
  originalSize: number;
  roundTripSize?: number;
  cellsPreserved?: boolean;
  error?: string;
}

interface ValidationReport {
  timestamp: string;
  corpusPath: string;
  summary: {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    byMode: {
      strict: { passed: number; failed: number };
      lenient: { passed: number; failed: number };
      permissive: { passed: number; failed: number };
    };
    byCategory: { [category: string]: { total: number; passed: number; failed: number } };
    roundTripSuccess: number;
    roundTripFailed: number;
  };
  results: ValidationResult[];
}

// =============================================================================
// Simple XLSX Parser (JavaScript implementation for validation)
// =============================================================================

interface ParsedXlsx {
  sheets: Array<{
    name: string;
    cells: Array<{
      ref: string;
      value?: string | number;
      formula?: string;
    }>;
  }>;
  sharedStrings: string[];
  errors: string[];
}

async function parseXlsx(buffer: ArrayBuffer, mode: ParserMode): Promise<ParsedXlsx> {
  const result: ParsedXlsx = {
    sheets: [],
    sharedStrings: [],
    errors: [],
  };

  try {
    const zip = await JSZip.loadAsync(buffer);

    // Parse shared strings
    const sst = await zip.file('xl/sharedStrings.xml')?.async('string');
    if (sst) {
      const matches = sst.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
      for (const match of matches) {
        result.sharedStrings.push(match[1]);
      }
    }

    // Parse workbook for sheet names
    const workbook = await zip.file('xl/workbook.xml')?.async('string');
    if (!workbook) {
      if (mode === 'strict') {
        throw new Error('Missing workbook.xml');
      }
      result.errors.push('Missing workbook.xml');
      return result;
    }

    // Extract sheet names and IDs
    const sheetMatches = workbook.matchAll(
      /<sheet[^>]+name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g,
    );
    const sheetInfos: Array<{ name: string; rId: string }> = [];
    for (const match of sheetMatches) {
      sheetInfos.push({ name: match[1], rId: match[2] });
    }

    // Parse relationships to map rIds to paths
    const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
    const rIdToPath = new Map<string, string>();
    if (rels) {
      const relMatches = rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g);
      for (const match of relMatches) {
        rIdToPath.set(match[1], match[2]);
      }
    }

    // Parse each worksheet
    for (const sheetInfo of sheetInfos) {
      let sheetPath = rIdToPath.get(sheetInfo.rId);
      if (!sheetPath) {
        // Try to guess the path
        const idx = sheetInfos.indexOf(sheetInfo) + 1;
        sheetPath = `worksheets/sheet${idx}.xml`;
      }

      const fullPath = sheetPath.startsWith('/') ? `xl${sheetPath}` : `xl/${sheetPath}`;
      const sheetXml = await zip.file(fullPath)?.async('string');

      if (!sheetXml) {
        if (mode === 'strict') {
          throw new Error(`Missing worksheet: ${fullPath}`);
        }
        result.errors.push(`Missing worksheet: ${fullPath}`);
        continue;
      }

      const sheet: (typeof result.sheets)[0] = {
        name: sheetInfo.name,
        cells: [],
      };

      // Parse cells - simple regex-based parsing
      try {
        const cellMatches = sheetXml.matchAll(/<c\s+[^>]*r="([^"]+)"[^>]*>([\s\S]*?)<\/c>/g);
        for (const match of cellMatches) {
          const ref = match[1];
          const content = match[2];

          const cell: (typeof sheet.cells)[0] = { ref };

          // Extract formula
          const formulaMatch = content.match(/<f[^>]*>([^<]*)<\/f>/);
          if (formulaMatch) {
            cell.formula = formulaMatch[1];
          }

          // Extract value
          const valueMatch = content.match(/<v>([^<]*)<\/v>/);
          if (valueMatch) {
            const valStr = valueMatch[1];
            // Check if it's a shared string reference
            const typeMatch = match[0].match(/t="([^"]+)"/);
            if (typeMatch && typeMatch[1] === 's') {
              const idx = parseInt(valStr, 10);
              if (idx < result.sharedStrings.length) {
                cell.value = result.sharedStrings[idx];
              } else if (mode === 'strict') {
                throw new Error(`Invalid shared string index: ${idx}`);
              } else {
                result.errors.push(`Invalid shared string index: ${idx}`);
              }
            } else {
              // Try to parse as number
              const num = parseFloat(valStr);
              cell.value = isNaN(num) ? valStr : num;
            }
          }

          sheet.cells.push(cell);
        }
      } catch (parseError) {
        if (mode === 'strict') {
          throw parseError;
        }
        result.errors.push(
          `Cell parsing error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }

      result.sheets.push(sheet);
    }
  } catch (error) {
    if (mode === 'strict') {
      throw error;
    }
    result.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

// =============================================================================
// Validation Functions
// =============================================================================

async function validateFile(filePath: string, mode: ParserMode): Promise<ModeResult> {
  const startTime = performance.now();

  try {
    const buffer = await fs.promises.readFile(filePath);
    const result = await parseXlsx(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mode,
    );

    const parseTimeMs = performance.now() - startTime;

    // Count cells across all sheets
    let cellCount = 0;
    for (const sheet of result.sheets) {
      cellCount += sheet.cells.length;
    }

    return {
      success: mode === 'strict' ? result.errors.length === 0 : true,
      parseTimeMs,
      cellCount,
      sheetCount: result.sheets.length,
      errorCount: result.errors.length,
      warnings: result.errors.length > 0 ? result.errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      parseTimeMs: performance.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function validateRoundTrip(filePath: string): Promise<RoundTripResult> {
  try {
    const originalBuffer = await fs.promises.readFile(filePath);
    const originalSize = originalBuffer.length;

    // Parse original
    const parsed = await parseXlsx(
      originalBuffer.buffer.slice(
        originalBuffer.byteOffset,
        originalBuffer.byteOffset + originalBuffer.byteLength,
      ),
      'lenient',
    );

    if (parsed.sheets.length === 0) {
      return {
        success: false,
        originalSize,
        error: 'No sheets parsed from original file',
      };
    }

    // Rebuild the XLSX
    const zip = new JSZip();

    // Build content types
    let contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`;

    for (let i = 0; i < parsed.sheets.length; i++) {
      contentTypes += `\n  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    }

    if (parsed.sharedStrings.length > 0) {
      contentTypes += `\n  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`;
    }

    contentTypes += `\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;
    contentTypes += '\n</Types>';

    zip.file('[Content_Types].xml', contentTypes);

    // Build root rels
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    );

    // Build workbook rels
    let wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

    for (let i = 0; i < parsed.sheets.length; i++) {
      wbRels += `\n  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
    }

    let nextId = parsed.sheets.length + 1;
    if (parsed.sharedStrings.length > 0) {
      wbRels += `\n  <Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
      nextId++;
    }
    wbRels += `\n  <Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    wbRels += '\n</Relationships>';

    zip.file('xl/_rels/workbook.xml.rels', wbRels);

    // Build workbook
    let workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>`;

    for (let i = 0; i < parsed.sheets.length; i++) {
      workbook += `\n    <sheet name="${escapeXml(parsed.sheets[i].name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    }

    workbook += `
  </sheets>
</workbook>`;

    zip.file('xl/workbook.xml', workbook);

    // Build worksheets
    for (let i = 0; i < parsed.sheets.length; i++) {
      const sheet = parsed.sheets[i];
      let sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>`;

      // Group cells by row
      const rowMap = new Map<number, typeof sheet.cells>();
      for (const cell of sheet.cells) {
        const match = cell.ref.match(/^([A-Z]+)(\d+)$/);
        if (!match) continue;
        const row = parseInt(match[2], 10);
        if (!rowMap.has(row)) rowMap.set(row, []);
        rowMap.get(row)!.push(cell);
      }

      const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);
      for (const [rowNum, cells] of sortedRows) {
        sheetXml += `\n    <row r="${rowNum}">`;
        for (const cell of cells) {
          sheetXml += `\n      <c r="${cell.ref}">`;
          if (cell.formula) {
            sheetXml += `<f>${escapeXml(cell.formula)}</f>`;
          }
          if (cell.value !== undefined) {
            sheetXml += `<v>${escapeXml(String(cell.value))}</v>`;
          }
          sheetXml += '</c>';
        }
        sheetXml += '\n    </row>';
      }

      sheetXml += `
  </sheetData>
</worksheet>`;

      zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml);
    }

    // Build shared strings
    if (parsed.sharedStrings.length > 0) {
      let sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${parsed.sharedStrings.length}" uniqueCount="${parsed.sharedStrings.length}">`;

      for (const str of parsed.sharedStrings) {
        sst += `\n  <si><t>${escapeXml(str)}</t></si>`;
      }

      sst += '\n</sst>';
      zip.file('xl/sharedStrings.xml', sst);
    }

    // Build minimal styles
    zip.file(
      'xl/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><name val="Calibri"/><sz val="11"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/></border></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf/></cellXfs>
</styleSheet>`,
    );

    // Generate the round-tripped buffer
    const roundTripBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    // Parse the round-tripped file
    const reparsed = await parseXlsx(roundTripBuffer, 'lenient');

    // Compare cell counts
    let originalCellCount = 0;
    let reparsedCellCount = 0;
    for (const sheet of parsed.sheets) {
      originalCellCount += sheet.cells.length;
    }
    for (const sheet of reparsed.sheets) {
      reparsedCellCount += sheet.cells.length;
    }

    return {
      success: reparsed.errors.length === 0,
      originalSize,
      roundTripSize: roundTripBuffer.byteLength,
      cellsPreserved: reparsedCellCount >= originalCellCount * 0.9, // Allow 10% loss for edge cases
    };
  } catch (error) {
    return {
      success: false,
      originalSize: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// Main Validation
// =============================================================================

async function findXlsxFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recurse into subdirectories
      files.push(...(await findXlsxFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.xlsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getCategory(filePath: string): string {
  const relativePath = path.relative(CORPUS_DIR, filePath);
  const parts = relativePath.split(path.sep);

  if (parts[0] === 'generated') {
    return parts[1] || 'generated';
  }
  if (parts[0] === 'malformed') {
    return `malformed/${parts[1] || 'other'}`;
  }
  return parts[0] || 'other';
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('XLSX Test Corpus Validation');
  console.log('='.repeat(60));
  console.log(`Corpus directory: ${CORPUS_DIR}`);
  console.log('');

  // Find all xlsx files
  const files = await findXlsxFiles(CORPUS_DIR);
  console.log(`Found ${files.length} XLSX files`);
  console.log('');

  const results: ValidationResult[] = [];
  const summary = {
    totalFiles: files.length,
    validFiles: 0,
    invalidFiles: 0,
    byMode: {
      strict: { passed: 0, failed: 0 },
      lenient: { passed: 0, failed: 0 },
      permissive: { passed: 0, failed: 0 },
    },
    byCategory: {} as { [category: string]: { total: number; passed: number; failed: number } },
    roundTripSuccess: 0,
    roundTripFailed: 0,
  };

  const modes: ParserMode[] = ['strict', 'lenient', 'permissive'];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relativePath = path.relative(CORPUS_DIR, filePath);
    const category = getCategory(filePath);
    const stats = await fs.promises.stat(filePath);

    // Initialize category stats
    if (!summary.byCategory[category]) {
      summary.byCategory[category] = { total: 0, passed: 0, failed: 0 };
    }
    summary.byCategory[category].total++;

    console.log(`[${i + 1}/${files.length}] ${relativePath}`);

    const result: ValidationResult = {
      file: filePath,
      relativePath,
      category,
      fileSize: stats.size,
      results: {
        strict: { success: false, parseTimeMs: 0 },
        lenient: { success: false, parseTimeMs: 0 },
        permissive: { success: false, parseTimeMs: 0 },
      },
    };

    // Test each mode
    for (const mode of modes) {
      const modeResult = await validateFile(filePath, mode);
      result.results[mode] = modeResult;

      if (modeResult.success) {
        summary.byMode[mode].passed++;
      } else {
        summary.byMode[mode].failed++;
      }

      process.stdout.write(`  ${mode}: ${modeResult.success ? 'PASS' : 'FAIL'}`);
      if (modeResult.error) {
        process.stdout.write(` (${modeResult.error.substring(0, 50)}...)`);
      }
      console.log('');
    }

    // Test round-trip for valid files
    if (result.results.lenient.success && !category.startsWith('malformed')) {
      const roundTripResult = await validateRoundTrip(filePath);
      result.roundTrip = roundTripResult;

      if (roundTripResult.success && roundTripResult.cellsPreserved) {
        summary.roundTripSuccess++;
        console.log(`  round-trip: PASS`);
      } else {
        summary.roundTripFailed++;
        console.log(`  round-trip: FAIL ${roundTripResult.error || '(cells not preserved)'}`);
      }
    }

    // Count valid files (can be parsed in lenient mode)
    if (result.results.lenient.success) {
      summary.validFiles++;
      summary.byCategory[category].passed++;
    } else {
      summary.invalidFiles++;
      summary.byCategory[category].failed++;
    }

    results.push(result);
    console.log('');
  }

  // Generate report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    corpusPath: CORPUS_DIR,
    summary,
    results,
  };

  await fs.promises.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  // Print summary
  console.log('='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Total files:        ${summary.totalFiles}`);
  console.log(`Valid (lenient):    ${summary.validFiles}`);
  console.log(`Invalid:            ${summary.invalidFiles}`);
  console.log('');
  console.log('By parsing mode:');
  console.log(
    `  Strict:     ${summary.byMode.strict.passed} passed, ${summary.byMode.strict.failed} failed`,
  );
  console.log(
    `  Lenient:    ${summary.byMode.lenient.passed} passed, ${summary.byMode.lenient.failed} failed`,
  );
  console.log(
    `  Permissive: ${summary.byMode.permissive.passed} passed, ${summary.byMode.permissive.failed} failed`,
  );
  console.log('');
  console.log('By category:');
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    console.log(`  ${category.padEnd(25)} ${stats.passed}/${stats.total} passed`);
  }
  console.log('');
  console.log('Round-trip:');
  console.log(`  Success: ${summary.roundTripSuccess}`);
  console.log(`  Failed:  ${summary.roundTripFailed}`);
  console.log('');
  console.log(`Report written to: ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error('Validation failed:', error);
  process.exit(1);
});
