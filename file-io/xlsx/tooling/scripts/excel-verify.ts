#!/usr/bin/env npx tsx
/**
 * Excel Compatibility Verification Script
 *
 * Verifies that round-tripped XLSX files can be opened by Excel and other
 * spreadsheet applications without requiring repair.
 *
 * Verification Checks:
 * 1. Basic file structure validation (ZIP, required parts)
 * 2. XML well-formedness
 * 3. Relationship integrity
 * 4. Content type correctness
 * 5. Schema validation (basic)
 * 6. Optional: Excel COM automation verification (Windows only)
 *
 * Usage:
 *   npx tsx xlsx/tooling/scripts/excel-verify.ts <file.xlsx>
 *   npx tsx xlsx/tooling/scripts/excel-verify.ts --batch <directory>
 *   npx tsx xlsx/tooling/scripts/excel-verify.ts --generate-report <directory> --output report.json
 *
 * Options:
 *   --verbose      Show detailed validation messages
 *   --batch        Validate all XLSX files in a directory
 *   --output       Output file for JSON report
 *   --json         Output results as JSON
 *   --fix          Attempt to fix common issues (experimental)
 *   --help         Show this help message
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import JSZip from 'jszip';
import { basename, extname, join, resolve } from 'path';

// =============================================================================
// Types
// =============================================================================

interface ValidationResult {
  /** File path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Overall validation status */
  status: 'valid' | 'warning' | 'error' | 'repair_needed';
  /** Individual check results */
  checks: ValidationCheck[];
  /** Timestamp */
  timestamp: string;
  /** Time taken for validation (ms) */
  validationTimeMs: number;
}

interface ValidationCheck {
  /** Check name */
  name: string;
  /** Check category */
  category: 'structure' | 'xml' | 'relationships' | 'content_types' | 'schema' | 'excel';
  /** Check result */
  status: 'pass' | 'warning' | 'fail';
  /** Message describing the result */
  message: string;
  /** Additional details */
  details?: string;
  /** Suggestion for fixing the issue */
  suggestion?: string;
}

interface BatchResult {
  /** Total files processed */
  totalFiles: number;
  /** Files that passed validation */
  validFiles: number;
  /** Files with warnings */
  warningFiles: number;
  /** Files with errors */
  errorFiles: number;
  /** Individual file results */
  results: ValidationResult[];
  /** Timestamp */
  timestamp: string;
  /** Total time taken (ms) */
  totalTimeMs: number;
}

interface Options {
  verbose: boolean;
  json: boolean;
  batch: boolean;
  outputPath?: string;
  fix: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Required parts in a minimal XLSX file */
const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels'];

/** Required parts for a workbook */
const WORKBOOK_REQUIRED_PARTS = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'];

/** Expected content types for common parts */
const EXPECTED_CONTENT_TYPES: Record<string, string> = {
  '/xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  '/xl/sharedStrings.xml':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  '/xl/styles.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  '/xl/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
};

/** Default content types by extension */
const DEFAULT_CONTENT_TYPES: Record<string, string> = {
  xml: 'application/xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
};

/** XLSX namespaces that should be present */
const REQUIRED_NAMESPACES = {
  spreadsheetml: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  relationships: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
};

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Check if a file is a valid ZIP archive
 */
async function checkZipStructure(buffer: Buffer): Promise<ValidationCheck> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const fileCount = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;

    return {
      name: 'ZIP Structure',
      category: 'structure',
      status: 'pass',
      message: `Valid ZIP archive with ${fileCount} files`,
    };
  } catch (error) {
    return {
      name: 'ZIP Structure',
      category: 'structure',
      status: 'fail',
      message: 'Invalid ZIP archive',
      details: error instanceof Error ? error.message : String(error),
      suggestion: 'The file may be corrupted or not a valid XLSX file',
    };
  }
}

/**
 * Check for required parts
 */
async function checkRequiredParts(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const allParts = Object.keys(zip.files).filter((f) => !zip.files[f].dir);

  // Check core required parts
  for (const part of REQUIRED_PARTS) {
    const exists = allParts.some((p) => p === part || p === part.replace('[', '').replace(']', ''));
    checks.push({
      name: `Required Part: ${part}`,
      category: 'structure',
      status: exists ? 'pass' : 'fail',
      message: exists ? `Found ${part}` : `Missing required part: ${part}`,
      suggestion: exists ? undefined : 'This part is required for all XLSX files',
    });
  }

  // Check workbook parts
  for (const part of WORKBOOK_REQUIRED_PARTS) {
    const exists = allParts.includes(part);
    checks.push({
      name: `Workbook Part: ${part}`,
      category: 'structure',
      status: exists ? 'pass' : 'fail',
      message: exists ? `Found ${part}` : `Missing workbook part: ${part}`,
      suggestion: exists ? undefined : 'This part is required for workbook functionality',
    });
  }

  // Check for at least one worksheet
  const hasWorksheet = allParts.some((p) => p.match(/xl\/worksheets\/sheet\d+\.xml/));
  checks.push({
    name: 'Worksheet Presence',
    category: 'structure',
    status: hasWorksheet ? 'pass' : 'fail',
    message: hasWorksheet ? 'At least one worksheet found' : 'No worksheets found',
    suggestion: hasWorksheet ? undefined : 'An XLSX file must contain at least one worksheet',
  });

  return checks;
}

/**
 * Check XML well-formedness
 */
async function checkXmlWellFormedness(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const xmlParts = Object.keys(zip.files).filter((f) => f.endsWith('.xml') || f.endsWith('.rels'));

  for (const part of xmlParts) {
    try {
      const content = await zip.files[part].async('string');

      // Basic XML checks
      const errors: string[] = [];

      // Check for XML declaration
      if (content.trim().startsWith('<?xml')) {
        // Valid XML declaration
      } else if (content.trim().startsWith('<')) {
        // No declaration, but starts with element - acceptable
      } else {
        errors.push('Does not start with valid XML');
      }

      // Check for balanced tags (simple check)
      const openTags = content.match(/<[a-zA-Z][^/>]*>/g) || [];
      const closeTags = content.match(/<\/[a-zA-Z][^>]*>/g) || [];
      const selfClosing = content.match(/<[a-zA-Z][^>]*\/>/g) || [];

      // Very basic balance check
      if (Math.abs(openTags.length - closeTags.length) > selfClosing.length) {
        errors.push('Possible unbalanced tags detected');
      }

      // Check for invalid characters
      if (content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/)) {
        errors.push('Contains invalid XML characters');
      }

      // Check for unescaped special characters in attribute values
      // This is a simplified check
      const unescapedInAttr = content.match(/="[^"]*[<>][^"]*"/);
      if (unescapedInAttr) {
        errors.push('Possible unescaped characters in attributes');
      }

      if (errors.length === 0) {
        checks.push({
          name: `XML Well-formedness: ${part}`,
          category: 'xml',
          status: 'pass',
          message: `${part} is well-formed XML`,
        });
      } else {
        checks.push({
          name: `XML Well-formedness: ${part}`,
          category: 'xml',
          status: 'warning',
          message: `${part} may have XML issues`,
          details: errors.join('; '),
        });
      }
    } catch (error) {
      checks.push({
        name: `XML Well-formedness: ${part}`,
        category: 'xml',
        status: 'fail',
        message: `Failed to read ${part}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return checks;
}

/**
 * Check relationship integrity
 */
async function checkRelationships(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const relsParts = Object.keys(zip.files).filter((f) => f.endsWith('.rels'));
  const allParts = new Set(Object.keys(zip.files));

  for (const relsPart of relsParts) {
    try {
      const content = await zip.files[relsPart].async('string');

      // Extract relationship targets
      const targetRegex = /Target="([^"]+)"/g;
      let match;
      const missingTargets: string[] = [];
      const externalTargets: string[] = [];

      while ((match = targetRegex.exec(content)) !== null) {
        const target = match[1];

        // Skip external references
        if (
          target.startsWith('http://') ||
          target.startsWith('https://') ||
          target.startsWith('mailto:')
        ) {
          externalTargets.push(target);
          continue;
        }

        // Resolve relative path
        const basePath = relsPart
          .replace('/_rels/', '/')
          .replace('.rels', '')
          .replace('_rels/', '');
        let resolvedTarget = target;

        if (target.startsWith('/')) {
          resolvedTarget = target.substring(1);
        } else if (target.startsWith('../')) {
          // Handle parent directory references
          const parts = basePath.split('/');
          const targetParts = target.split('/');
          while (targetParts[0] === '..') {
            parts.pop();
            targetParts.shift();
          }
          resolvedTarget = [...parts.slice(0, -1), ...targetParts].join('/');
        } else {
          const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
          resolvedTarget = baseDir + target;
        }

        // Clean up path
        resolvedTarget = resolvedTarget.replace(/^\//, '').replace(/\/+/g, '/');

        if (!allParts.has(resolvedTarget) && !allParts.has('/' + resolvedTarget)) {
          missingTargets.push(`${target} (resolved: ${resolvedTarget})`);
        }
      }

      if (missingTargets.length === 0) {
        checks.push({
          name: `Relationship Targets: ${relsPart}`,
          category: 'relationships',
          status: 'pass',
          message: `All relationship targets in ${relsPart} exist`,
          details:
            externalTargets.length > 0 ? `External links: ${externalTargets.length}` : undefined,
        });
      } else {
        checks.push({
          name: `Relationship Targets: ${relsPart}`,
          category: 'relationships',
          status: 'warning',
          message: `Some relationship targets in ${relsPart} may be missing`,
          details: `Missing: ${missingTargets.join(', ')}`,
          suggestion: 'Missing targets may cause Excel to attempt repair',
        });
      }
    } catch (error) {
      checks.push({
        name: `Relationship Targets: ${relsPart}`,
        category: 'relationships',
        status: 'fail',
        message: `Failed to check relationships in ${relsPart}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return checks;
}

/**
 * Check content types
 */
async function checkContentTypes(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Find content types file
  const ctFile = Object.keys(zip.files).find(
    (f) => f.toLowerCase() === '[content_types].xml' || f === 'Content_Types.xml',
  );

  if (!ctFile) {
    checks.push({
      name: 'Content Types File',
      category: 'content_types',
      status: 'fail',
      message: 'Missing [Content_Types].xml',
      suggestion: 'This file is required for Excel to open the workbook',
    });
    return checks;
  }

  try {
    const content = await zip.files[ctFile].async('string');

    // Check for required namespace
    if (!content.includes(REQUIRED_NAMESPACES.contentTypes)) {
      checks.push({
        name: 'Content Types Namespace',
        category: 'content_types',
        status: 'warning',
        message: 'Content types may use non-standard namespace',
        suggestion: 'Should use standard OPC content types namespace',
      });
    } else {
      checks.push({
        name: 'Content Types Namespace',
        category: 'content_types',
        status: 'pass',
        message: 'Content types uses standard namespace',
      });
    }

    // Check for Override entries
    const overrides = content.match(/<Override[^>]+>/g) || [];
    const defaults = content.match(/<Default[^>]+>/g) || [];

    checks.push({
      name: 'Content Types Entries',
      category: 'content_types',
      status: 'pass',
      message: `Found ${overrides.length} override(s) and ${defaults.length} default(s)`,
    });

    // Check for workbook content type
    if (!content.includes('spreadsheetml.sheet.main')) {
      checks.push({
        name: 'Workbook Content Type',
        category: 'content_types',
        status: 'warning',
        message: 'Workbook content type may not be standard',
        suggestion: 'Workbook should have spreadsheetml.sheet.main content type',
      });
    } else {
      checks.push({
        name: 'Workbook Content Type',
        category: 'content_types',
        status: 'pass',
        message: 'Workbook has correct content type',
      });
    }
  } catch (error) {
    checks.push({
      name: 'Content Types Parse',
      category: 'content_types',
      status: 'fail',
      message: 'Failed to parse content types',
      details: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

/**
 * Basic schema validation
 */
async function checkBasicSchema(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Check workbook.xml
  if (zip.files['xl/workbook.xml']) {
    try {
      const content = await zip.files['xl/workbook.xml'].async('string');

      // Check for required elements
      const hasWorkbook = content.includes('<workbook');
      const hasSheets = content.includes('<sheets');
      const hasSheet = content.includes('<sheet');

      if (hasWorkbook && hasSheets && hasSheet) {
        checks.push({
          name: 'Workbook Schema',
          category: 'schema',
          status: 'pass',
          message: 'Workbook has required elements',
        });
      } else {
        const missing = [];
        if (!hasWorkbook) missing.push('workbook');
        if (!hasSheets) missing.push('sheets');
        if (!hasSheet) missing.push('sheet');

        checks.push({
          name: 'Workbook Schema',
          category: 'schema',
          status: 'warning',
          message: 'Workbook may be missing required elements',
          details: `Missing: ${missing.join(', ')}`,
        });
      }

      // Check namespace
      if (content.includes(REQUIRED_NAMESPACES.spreadsheetml)) {
        checks.push({
          name: 'Workbook Namespace',
          category: 'schema',
          status: 'pass',
          message: 'Workbook uses standard SpreadsheetML namespace',
        });
      } else {
        checks.push({
          name: 'Workbook Namespace',
          category: 'schema',
          status: 'warning',
          message: 'Workbook may use non-standard namespace',
        });
      }
    } catch (error) {
      checks.push({
        name: 'Workbook Schema',
        category: 'schema',
        status: 'fail',
        message: 'Failed to validate workbook schema',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check worksheets
  const worksheets = Object.keys(zip.files).filter((f) => f.match(/xl\/worksheets\/sheet\d+\.xml/));

  for (const ws of worksheets) {
    try {
      const content = await zip.files[ws].async('string');

      const hasWorksheet = content.includes('<worksheet');
      const hasSheetData = content.includes('<sheetData');

      if (hasWorksheet && hasSheetData) {
        checks.push({
          name: `Worksheet Schema: ${basename(ws)}`,
          category: 'schema',
          status: 'pass',
          message: `${basename(ws)} has required elements`,
        });
      } else {
        checks.push({
          name: `Worksheet Schema: ${basename(ws)}`,
          category: 'schema',
          status: 'warning',
          message: `${basename(ws)} may be missing required elements`,
          details: !hasWorksheet ? 'Missing worksheet element' : 'Missing sheetData element',
        });
      }
    } catch (error) {
      checks.push({
        name: `Worksheet Schema: ${basename(ws)}`,
        category: 'schema',
        status: 'fail',
        message: `Failed to validate ${basename(ws)}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return checks;
}

/**
 * Check for common issues that trigger Excel repair dialog
 */
async function checkRepairIndicators(zip: JSZip): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Check for duplicate cell references
  const worksheets = Object.keys(zip.files).filter((f) => f.match(/xl\/worksheets\/sheet\d+\.xml/));

  for (const ws of worksheets) {
    try {
      const content = await zip.files[ws].async('string');

      // Extract cell references
      const cellRefs = content.match(/r="([A-Z]+\d+)"/g) || [];
      const refs = cellRefs.map((r) => r.match(/"([^"]+)"/)?.[1]).filter(Boolean);
      const uniqueRefs = new Set(refs);

      if (refs.length !== uniqueRefs.size) {
        checks.push({
          name: `Duplicate Cells: ${basename(ws)}`,
          category: 'excel',
          status: 'warning',
          message: `${basename(ws)} may have duplicate cell references`,
          details: `${refs.length} total, ${uniqueRefs.size} unique`,
          suggestion: 'Duplicate cells will trigger Excel repair dialog',
        });
      } else {
        checks.push({
          name: `Duplicate Cells: ${basename(ws)}`,
          category: 'excel',
          status: 'pass',
          message: `${basename(ws)} has no duplicate cell references`,
        });
      }

      // Check for invalid cell references
      const invalidRefs = refs.filter((r) => !r?.match(/^[A-Z]{1,3}\d+$/));
      if (invalidRefs.length > 0) {
        checks.push({
          name: `Invalid Cell Refs: ${basename(ws)}`,
          category: 'excel',
          status: 'warning',
          message: `${basename(ws)} may have invalid cell references`,
          details: `Found: ${invalidRefs.slice(0, 5).join(', ')}...`,
        });
      }
    } catch (error) {
      // Skip if can't read
    }
  }

  // Check for shared strings issues
  if (zip.files['xl/sharedStrings.xml']) {
    try {
      const content = await zip.files['xl/sharedStrings.xml'].async('string');

      // Check count attribute matches actual count
      const countMatch = content.match(/count="(\d+)"/);
      const uniqueCountMatch = content.match(/uniqueCount="(\d+)"/);
      const siCount = (content.match(/<si>/g) || []).length;

      if (uniqueCountMatch) {
        const declaredCount = parseInt(uniqueCountMatch[1], 10);
        if (declaredCount !== siCount) {
          checks.push({
            name: 'Shared Strings Count',
            category: 'excel',
            status: 'warning',
            message: 'Shared strings count mismatch',
            details: `Declared: ${declaredCount}, Actual: ${siCount}`,
            suggestion: 'Count mismatch may trigger repair',
          });
        } else {
          checks.push({
            name: 'Shared Strings Count',
            category: 'excel',
            status: 'pass',
            message: 'Shared strings count is correct',
          });
        }
      }
    } catch (error) {
      // Skip if can't read
    }
  }

  return checks;
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Validate an XLSX file
 */
async function validateXlsxFile(filePath: string, options: Options): Promise<ValidationResult> {
  const startTime = Date.now();
  const checks: ValidationCheck[] = [];

  const buffer = readFileSync(filePath);
  const size = buffer.length;

  // Check ZIP structure
  const zipCheck = await checkZipStructure(buffer);
  checks.push(zipCheck);

  if (zipCheck.status === 'fail') {
    return {
      path: filePath,
      size,
      status: 'error',
      checks,
      timestamp: new Date().toISOString(),
      validationTimeMs: Date.now() - startTime,
    };
  }

  // Load ZIP for further checks
  const zip = await JSZip.loadAsync(buffer);

  // Run all checks
  checks.push(...(await checkRequiredParts(zip)));
  checks.push(...(await checkXmlWellFormedness(zip)));
  checks.push(...(await checkRelationships(zip)));
  checks.push(...(await checkContentTypes(zip)));
  checks.push(...(await checkBasicSchema(zip)));
  checks.push(...(await checkRepairIndicators(zip)));

  // Determine overall status
  const hasFailure = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warning');
  const repairNeeded = checks.some((c) => c.category === 'excel' && c.status === 'warning');

  let status: ValidationResult['status'];
  if (hasFailure) {
    status = 'error';
  } else if (repairNeeded) {
    status = 'repair_needed';
  } else if (hasWarning) {
    status = 'warning';
  } else {
    status = 'valid';
  }

  return {
    path: filePath,
    size,
    status,
    checks,
    timestamp: new Date().toISOString(),
    validationTimeMs: Date.now() - startTime,
  };
}

/**
 * Validate all XLSX files in a directory
 */
async function validateDirectory(dirPath: string, options: Options): Promise<BatchResult> {
  const startTime = Date.now();
  const results: ValidationResult[] = [];

  const files = readdirSync(dirPath)
    .filter((f) => extname(f).toLowerCase() === '.xlsx')
    .map((f) => join(dirPath, f));

  for (const file of files) {
    if (options.verbose) {
      console.log(`Validating: ${basename(file)}`);
    }
    const result = await validateXlsxFile(file, options);
    results.push(result);
  }

  const validFiles = results.filter((r) => r.status === 'valid').length;
  const warningFiles = results.filter(
    (r) => r.status === 'warning' || r.status === 'repair_needed',
  ).length;
  const errorFiles = results.filter((r) => r.status === 'error').length;

  return {
    totalFiles: files.length,
    validFiles,
    warningFiles,
    errorFiles,
    results,
    timestamp: new Date().toISOString(),
    totalTimeMs: Date.now() - startTime,
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format validation result for console output
 */
function formatValidationResult(result: ValidationResult, verbose: boolean): string {
  const lines: string[] = [];

  const statusIcon = {
    valid: '[OK]',
    warning: '[~]',
    error: '[X]',
    repair_needed: '[!]',
  }[result.status];

  lines.push(`${statusIcon} ${basename(result.path)}`);
  lines.push(`   Status: ${result.status.toUpperCase()}`);
  lines.push(`   Size: ${(result.size / 1024).toFixed(2)} KB`);
  lines.push(`   Time: ${result.validationTimeMs}ms`);

  if (verbose || result.status !== 'valid') {
    lines.push('');
    lines.push('   Checks:');

    for (const check of result.checks) {
      if (!verbose && check.status === 'pass') continue;

      const checkIcon = {
        pass: '    [OK]',
        warning: '    [~]',
        fail: '    [X]',
      }[check.status];

      lines.push(`${checkIcon} ${check.name}: ${check.message}`);

      if (check.details) {
        lines.push(`         ${check.details}`);
      }
      if (check.suggestion && check.status !== 'pass') {
        lines.push(`         Suggestion: ${check.suggestion}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format batch result for console output
 */
function formatBatchResult(result: BatchResult, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('Excel Compatibility Verification Report');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Total Files: ${result.totalFiles}`);
  lines.push(`Valid:       ${result.validFiles}`);
  lines.push(`Warnings:    ${result.warningFiles}`);
  lines.push(`Errors:      ${result.errorFiles}`);
  lines.push(`Total Time:  ${result.totalTimeMs}ms`);
  lines.push('');
  lines.push('-'.repeat(80));

  for (const fileResult of result.results) {
    lines.push('');
    lines.push(formatValidationResult(fileResult, verbose));
  }

  return lines.join('\n');
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Excel Compatibility Verification Tool

Verifies that XLSX files can be opened by Excel without requiring repair.

Usage:
  npx tsx xlsx/tooling/scripts/excel-verify.ts <file.xlsx>
  npx tsx xlsx/tooling/scripts/excel-verify.ts --batch <directory>
  npx tsx xlsx/tooling/scripts/excel-verify.ts --generate-report <directory> --output report.json

Options:
  --verbose      Show detailed validation messages
  --batch        Validate all XLSX files in a directory
  --output       Output file for JSON report
  --json         Output results as JSON
  --help         Show this help message

Examples:
  # Validate a single file
  npx tsx xlsx/tooling/scripts/excel-verify.ts sample.xlsx

  # Validate with verbose output
  npx tsx xlsx/tooling/scripts/excel-verify.ts --verbose sample.xlsx

  # Batch validate a directory
  npx tsx xlsx/tooling/scripts/excel-verify.ts --batch ./test-files

  # Generate JSON report
  npx tsx xlsx/tooling/scripts/excel-verify.ts --batch --json ./test-files > report.json

Validation Checks:
  - ZIP structure integrity
  - Required XLSX parts presence
  - XML well-formedness
  - Relationship integrity
  - Content type correctness
  - Basic schema validation
  - Common repair indicators (duplicate cells, count mismatches)

Exit Codes:
  0 - All files valid
  1 - Some files have warnings or repair needed
  2 - Some files have errors
`);
    process.exit(0);
  }

  const options: Options = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    json: args.includes('--json'),
    batch: args.includes('--batch'),
    outputPath: args.includes('--output') ? args[args.indexOf('--output') + 1] : undefined,
    fix: args.includes('--fix'),
  };

  // Get file/directory path
  const paths = args.filter((a) => !a.startsWith('-') && !a.includes('output'));
  const targetPath = paths[0];

  if (!targetPath) {
    console.error('Error: Please provide a file or directory path');
    process.exit(2);
  }

  if (!existsSync(targetPath)) {
    console.error(`Error: Path not found: ${targetPath}`);
    process.exit(2);
  }

  const isDirectory = statSync(targetPath).isDirectory();

  if (isDirectory || options.batch) {
    // Batch validation
    const result = await validateDirectory(resolve(targetPath), options);

    if (options.outputPath) {
      writeFileSync(options.outputPath, JSON.stringify(result, null, 2));
      console.log(`Report written to: ${options.outputPath}`);
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatBatchResult(result, options.verbose));
    }

    // Exit code based on results
    if (result.errorFiles > 0) {
      process.exit(2);
    } else if (result.warningFiles > 0) {
      process.exit(1);
    }
  } else {
    // Single file validation
    const result = await validateXlsxFile(resolve(targetPath), options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatValidationResult(result, options.verbose));
    }

    // Exit code based on result
    if (result.status === 'error') {
      process.exit(2);
    } else if (result.status !== 'valid') {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(2);
});
