/**
 * CellFormat drift detection test.
 *
 * Compares the Rust-generated CellFormat field names (from constants.gen.ts)
 * against the hand-maintained CellFormat interface in @mog-sdk/contracts.
 *
 * If someone adds a field to Rust CellFormat but not TS (or vice versa), this test
 * fails with an explicit diff showing exactly which fields are missing.
 *
 * Regenerate the Rust field list:
 *   cd os && cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
 */

import { RUST_CELL_FORMAT_FIELDS } from '../constants.gen';
import type { CellFormat } from '@mog-sdk/contracts/core';

// ---------------------------------------------------------------------------
// Build the set of TS CellFormat keys at compile time.
//
// TypeScript interfaces are erased at runtime, so we can't do `Object.keys()`.
// Instead, we declare a typed object with every key of CellFormat set to `true`
// and extract the keys. If CellFormat gains a new field and this object doesn't
// include it, the compiler will NOT catch it (structural typing allows subsets).
// So we use a mapped-type assertion to force exhaustiveness.
// ---------------------------------------------------------------------------

/**
 * Exhaustive key map — the `satisfies` clause ensures every key of CellFormat
 * is present. If a key is added to CellFormat, TypeScript will error here
 * until it is added to this map.
 */
const TS_CELL_FORMAT_KEY_MAP: { [K in keyof Required<CellFormat>]: true } = {
  // Number format
  numberFormat: true,
  numberFormatType: true,
  // Font
  fontFamily: true,
  fontSize: true,
  fontTheme: true,
  fontColor: true,
  fontColorTint: true,
  fontCharset: true,
  fontFamilyType: true,
  bold: true,
  italic: true,
  underlineType: true,
  strikethrough: true,
  superscript: true,
  subscript: true,
  fontOutline: true,
  fontShadow: true,
  // Alignment
  horizontalAlign: true,
  verticalAlign: true,
  wrapText: true,
  textRotation: true,
  indent: true,
  shrinkToFit: true,
  readingOrder: true,
  autoIndent: true,
  // Fill
  backgroundColor: true,
  backgroundColorTint: true,
  patternType: true,
  patternForegroundColor: true,
  patternForegroundColorTint: true,
  gradientFill: true,
  // Border
  borders: true,
  // Protection
  locked: true,
  hidden: true,
  forcedTextMode: true,
  pivotButton: true,
  // Extensible
  extensions: true,
};

const TS_CELL_FORMAT_FIELDS: Set<string> = new Set(Object.keys(TS_CELL_FORMAT_KEY_MAP));
const RUST_FIELDS: Set<string> = new Set(RUST_CELL_FORMAT_FIELDS as readonly string[]);

// ---------------------------------------------------------------------------
// Fields that are intentionally only on one side.
//
// Document WHY each field is allowed to differ. This acts as an explicit
// allow-list — any NEW drift requires adding an entry here with justification,
// or adding the field to both sides.
// ---------------------------------------------------------------------------

/** Fields in TS CellFormat that intentionally have no Rust counterpart. */
const TS_ONLY_ALLOWED: Record<string, string> = {
  numberFormatType:
    'Derived/cached classification (e.g. "date", "currency") — computed by TS format engine, not stored in Rust',
};

/** Fields in Rust CellFormat that intentionally have no TS counterpart. */
const RUST_ONLY_ALLOWED: Record<string, string> = {};

/** Fields in TS that map to a differently-named Rust field (semantic equivalents). */
const FIELD_RENAMES: Record<string, string> = {
  // TS name -> Rust name
  forcedTextMode: 'quotePrefix',
};

describe('CellFormat drift detection', () => {
  test('every Rust CellFormat field is accounted for in TS (present or explicitly allowed)', () => {
    const tsFieldsWithRenames: Set<string> = new Set(TS_CELL_FORMAT_FIELDS);
    // Add Rust-side names for renamed fields
    for (const rustName of Object.values(FIELD_RENAMES)) {
      tsFieldsWithRenames.add(rustName);
    }

    const unexpectedRustOnly: string[] = [];
    for (const field of RUST_FIELDS) {
      if (!tsFieldsWithRenames.has(field) && !(field in RUST_ONLY_ALLOWED)) {
        unexpectedRustOnly.push(field);
      }
    }

    if (unexpectedRustOnly.length > 0) {
      throw new Error(
        `Rust CellFormat has fields not in TS CellFormat and not in RUST_ONLY_ALLOWED:\n` +
          `  ${unexpectedRustOnly.join(', ')}\n\n` +
          `Fix: add these fields to the TS CellFormat interface in contracts/src/core/core.ts,\n` +
          `or add them to RUST_ONLY_ALLOWED in this test with a justification.`,
      );
    }
  });

  test('every TS CellFormat field is accounted for in Rust (present or explicitly allowed)', () => {
    const rustFieldsWithRenames: Set<string> = new Set(RUST_FIELDS);
    // Add TS-side names for renamed fields
    for (const tsName of Object.keys(FIELD_RENAMES)) {
      rustFieldsWithRenames.add(tsName);
    }

    const unexpectedTsOnly: string[] = [];
    for (const field of TS_CELL_FORMAT_FIELDS) {
      if (!rustFieldsWithRenames.has(field) && !(field in TS_ONLY_ALLOWED)) {
        unexpectedTsOnly.push(field);
      }
    }

    if (unexpectedTsOnly.length > 0) {
      throw new Error(
        `TS CellFormat has fields not in Rust CellFormat and not in TS_ONLY_ALLOWED:\n` +
          `  ${unexpectedTsOnly.join(', ')}\n\n` +
          `Fix: add these fields to the Rust CellFormat struct in domain-types/src/cell_format.rs,\n` +
          `then regenerate: cd os && cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts\n` +
          `or add them to TS_ONLY_ALLOWED in this test with a justification.`,
      );
    }
  });

  test('RUST_CELL_FORMAT_FIELDS is not empty (codegen sanity check)', () => {
    expect(RUST_CELL_FORMAT_FIELDS.length).toBeGreaterThan(20);
  });

  test('TS exhaustive key map matches actual interface (compile-time guard)', () => {
    // This test exists to document the compile-time guard. The real protection
    // is the `satisfies` mapped type on TS_CELL_FORMAT_KEY_MAP — if CellFormat
    // gains a field, TypeScript will refuse to compile this test file until
    // the key map is updated.
    expect(Object.keys(TS_CELL_FORMAT_KEY_MAP).length).toBeGreaterThan(20);
  });

  test('allowed exceptions are still valid (no stale entries)', () => {
    // If a TS-only field gets added to Rust, the allow-list entry is stale
    for (const field of Object.keys(TS_ONLY_ALLOWED)) {
      const isStillTsOnly = TS_CELL_FORMAT_FIELDS.has(field) && !RUST_FIELDS.has(field);
      if (!isStillTsOnly) {
        // Check if it's a renamed field
        const rustName = FIELD_RENAMES[field];
        const isRenamed = rustName && RUST_FIELDS.has(rustName);
        if (!isRenamed) {
          throw new Error(
            `TS_ONLY_ALLOWED['${field}'] is stale — this field now exists in both Rust and TS, ` +
              `or no longer exists in TS. Remove it from the allow-list.`,
          );
        }
      }
    }

    for (const field of Object.keys(RUST_ONLY_ALLOWED)) {
      const isStillRustOnly = RUST_FIELDS.has(field) && !TS_CELL_FORMAT_FIELDS.has(field);
      if (!isStillRustOnly) {
        throw new Error(
          `RUST_ONLY_ALLOWED['${field}'] is stale — this field now exists in both Rust and TS, ` +
            `or no longer exists in Rust. Remove it from the allow-list.`,
        );
      }
    }
  });

  test('FIELD_RENAMES entries are valid (both sides exist)', () => {
    for (const [tsName, rustName] of Object.entries(FIELD_RENAMES)) {
      expect(TS_CELL_FORMAT_FIELDS.has(tsName)).toBe(true);
      expect(RUST_FIELDS.has(rustName)).toBe(true);
    }
  });
});
