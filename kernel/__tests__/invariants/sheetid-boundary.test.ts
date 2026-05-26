/**
 * SheetId brand-boundary invariant
 *
 * Enforces two structural rules that protect the SheetId branded type from
 * regressing into untyped `string` flow:
 *
 * 1. **No `as SheetId` casts in production code.** Casts skip even the
 *    trivial runtime function boundary that the factory provides, and they
 *    hide where raw strings enter the system.
 *
 * 2. **The unaliased `sheetId(...)` factory is only called at public-API
 *    entry files.** Those are the only places where the system accepts a
 *    raw user-supplied string identifier and needs to brand it. Anywhere
 *    else uses either the `toSheetId` alias (wire-seam / bridge code,
 *    consumes Rust-serialized strings) or — preferably — flows a branded
 *    `SheetId` in by type.
 *
 * No rule governs `toSheetId(...)` call sites. Today, wire-format types
 * auto-generated from Rust (`StoredSlicer`, `CellPositionResult`,
 * `TableConfig` from `compute-types.gen.ts`, etc.) carry `sheetId: string`,
 * so any consumer of a wire field legitimately brands on first read. A
 * follow-up round will brand the wire types themselves; once that lands,
 * a stricter invariant becomes possible.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(TEST_DIR, '../../..');

// Files allowed to use the unaliased `sheetId(...)` factory — i.e. public
// API entry points that accept user-supplied strings and validate-and-brand
// before passing inward.
//
// Each entry is a repo-relative file suffix. Keep this list as short as
// possible. When a new entry is proposed, the reviewer's job is to ask:
// "Is this genuinely a new boundary, or did we miss the inward propagation?"
// The default answer is the latter — push the type upstream, don't add here.
const PUBLIC_API_ENTRY_FILES = [
  // WorkbookImpl — user-facing Workbook surface. Brands via this.stateProvider
  // reads and via sheet-name-lookup return paths.
  'kernel/src/api/workbook/workbook-impl.ts',
  // WorksheetImpl — user-facing Worksheet surface (mostly receives already
  // branded SheetId from WorkbookImpl, but may brand in future).
  'kernel/src/api/worksheet/worksheet-impl.ts',
  // WorkbookNamesImpl — public `workbook.names` surface; `createFromSelection`
  // accepts `string | SheetId` and brands the string branch.
  'kernel/src/api/workbook/names.ts',
  // WorkbookSlicersImpl — public `workbook.slicers` surface; brands
  // stored.sheetId at the wire `StoredSlicer` seam (auto-generated type
  // still carries raw string; this file is effectively the adapter).
  'kernel/src/api/workbook/slicers.ts',
];

// Known method-name collisions where a symbol unrelated to the brand factory
// happens to be spelled `sheetId(...)`. Keep this list as short as possible;
// prefer renaming the method if feasible.
const METHOD_NAME_COLLISIONS = [
  // `BinaryMutationReader.sheetId(): string` decodes a sheet ID from bytes.
  // Unrelated to the `sheetId` brand factory.
  'kernel/src/bridges/wire/binary-mutation-reader.ts',
];

function gitGrep(pattern: string, paths: string[]): string[] {
  try {
    const raw = execSync(`git grep -n --extended-regexp '${pattern}' -- ${paths.join(' ')}`, {
      cwd: REPO,
      encoding: 'utf8',
    });
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function stripLinePrefix(line: string): { file: string; lineNo: string; body: string } {
  const [file, lineNo, ...rest] = line.split(':');
  return { file, lineNo, body: rest.join(':') };
}

function isCommentLine(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function isTestPath(file: string): boolean {
  return file.includes('/__tests__/') || /\.test\.tsx?$/.test(file);
}

describe('SheetId brand-boundary invariant', () => {
  it('no `as SheetId` casts in production code', () => {
    const hits = gitGrep('as[[:space:]]+SheetId', ['kernel/src', 'contracts/src']);
    const offenders = hits.filter((line) => {
      const { file } = stripLinePrefix(line);
      if (isTestPath(file)) return false;
      // The factory's own implementation (`return id as SheetId;`) is the
      // one legitimate cast.
      if (file.endsWith('contracts/src/core/core.ts')) return false;
      return true;
    });

    if (offenders.length > 0) {
      const msg = [
        'Found `as SheetId` casts in production code:',
        ...offenders.map((o) => `  ${o}`),
        '',
        'Fix: push the branded type upstream (change the caller signature)',
        'instead of asserting at the call site. If the value comes from a',
        'wire type (auto-generated from Rust), brand it with the',
        'toSheetId(...) factory at the wire seam.',
      ].join('\n');
      throw new Error(msg);
    }
  });

  it('unaliased `sheetId(...)` factory is only called at public-API entry files', () => {
    // Regex rationale:
    //   [^.A-Za-z0-9_]  — char before `sheetId` is not a word char AND not
    //                      `.`. Excludes both identifiers-ending-in-sheetId
    //                      (e.g. `getActiveSheetId`) and method-call syntax
    //                      (e.g. `reader.sheetId()`).
    //   sheetId[[:space:]]*\(  — factory call syntax.
    //
    // Separately filtered out: the `to` prefix (the aliased import
    // `sheetId as toSheetId`), which is the conventional wire-seam factory
    // and is allowed everywhere. We detect `toSheetId(` by checking the
    // two characters preceding the match.
    const hits = gitGrep('[^.A-Za-z0-9_]sheetId[[:space:]]*\\(', ['kernel/src', 'contracts/src']);
    const offenders = hits.filter((line) => {
      const { file, body } = stripLinePrefix(line);

      // Test files construct branded values as fixtures — exempt.
      if (isTestPath(file)) return false;
      if (isCommentLine(body)) return false;

      // Skip import lines (`import { sheetId } from ...`).
      if (/import\s+.*sheetId/.test(body)) return false;

      // Skip the factory declaration itself.
      if (file.endsWith('contracts/src/core/core.ts')) return false;

      // Skip known method-name collisions.
      if (METHOD_NAME_COLLISIONS.some((m) => file.endsWith(m))) return false;

      // The `[^.A-Za-z0-9_]sheetId\(` pattern still matches `toSheetId(`
      // because `o` is alphanumeric — wait, actually it does not, because
      // the char before `sheetId` in `toSheetId(` is `o` which IS alnum.
      // So the regex already excludes `toSheetId(`. Good. But double-check
      // by hand:
      if (/toSheetId[[:space:]]*\(/.test(body)) {
        // Defensive: if a line happens to include both, re-inspect.
        // If the only `sheetId(` occurrence in the line is part of
        // `toSheetId(`, skip.
        const withoutTo = body.replace(/toSheetId[[:space:]]*\(/g, '');
        if (!/[^.A-Za-z0-9_]sheetId[[:space:]]*\(/.test(' ' + withoutTo)) {
          return false;
        }
      }

      return !PUBLIC_API_ENTRY_FILES.some((allow) => file.endsWith(allow));
    });

    if (offenders.length > 0) {
      const msg = [
        'Found unaliased `sheetId(...)` factory calls outside public-API entry files:',
        ...offenders.map((o) => `  ${o}`),
        '',
        'Allowed files:',
        ...PUBLIC_API_ENTRY_FILES.map((f) => `  - ${f}`),
        '',
        'Fix: for wire-seam brands (consuming a string from a Rust-generated',
        'type), import as `sheetId as toSheetId` and call toSheetId(...). For',
        'internal helpers, change the parameter type to SheetId — the brand',
        'should flow in by type, not be re-established locally.',
      ].join('\n');
      throw new Error(msg);
    }
  });
});
