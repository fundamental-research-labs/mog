/**
 * Structural Lint Test: Overlay Canvas/Page Coordinate Boundary Guard
 *
 * Enforces that DOM overlays positioning themselves over the canvas use the
 * page-coordinate API (`gridRenderer.getCellPageBounds` / `getRangePageBounds`)
 * — NOT canvas-relative coords from `coords.cellToViewport` / `rangeToViewport`
 * combined with hand-rolled `containerRect.left + cellRect.x`-style arithmetic.
 *
 * Background: `cellToViewport`/`rangeToViewport` return canvas-relative coords
 * (origin at the canvas element, after row/column-header offsets). DOM popups
 * using `position: fixed`, Radix Portal, or absolute positioning at the
 * document level expect page-relative coords. Mixing them ships popups off the
 * intended cell — the kind of bug that broke `remove-duplicates-preserves-order`
 * in app-eval (FlashFillSuggestionsPopup landed atop B2 and stole the click).
 *
 * The right shape is `gridRenderer.getCellPageBounds(...)` /
 * `getRangePageBounds(...)`, which encapsulate the canvas/page boundary in
 * exactly one place.
 *
 * This test:
 * 1. Auto-discovers overlay files (cellToViewport/rangeToViewport AND any of:
 * Radix Portal patterns, `position: 'fixed'`) and fails if any are still
 * using the legacy offset-math pattern without being declared in
 * OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH below.
 * 2. Asserts OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH is empty — the goal state
 * is no manual offset arithmetic anywhere.
 *
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPREADSHEET_SRC = path.resolve(__dirname, '../..');

/**
 * Files still combining `cellToViewport`/`rangeToViewport` with manual page-offset
 * arithmetic (`containerRect.left + cellRect.x` / `canvasRect.left + cellRect.x` /
 * `offsetX + cellRect.x`). The intended steady state is empty — every overlay
 * should call `getCellPageBounds`/`getRangePageBounds` instead.
 *
 * If you are adding a new overlay and find yourself wanting to add a file here,
 * convert it to `getCellPageBounds`/`getRangePageBounds` instead.
 */
const OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH: string[] = [];

/**
 * Patterns that indicate manual canvas→page offset conversion (the legacy shape).
 * At least one must appear in each file listed above.
 */
const LEGACY_OFFSET_PATTERNS: RegExp[] = [
  /containerRect\s*[?.]?\s*(?:left|top)\s*\+/, // containerRect.left + ...
  /canvasRect\s*[?.]?\s*(?:left|top)\s*\+/, // canvasRect.left + ...
  /offsetX\s*\+/, // offsetX + ...
  /offsetY\s*\+/, // offsetY + ...
];

/**
 * Patterns that indicate the file is a DOM overlay positioning over the page
 * (escaping the canvas's coord space).
 *
 * - `PopoverAnchor` / `createVirtualRef` / `new DOMRect`: Radix Portal anchoring.
 * - `position: 'fixed'` (or "fixed" via shorthand): document-viewport positioning.
 *
 * `position: 'absolute'` is intentionally NOT flagged: in-canvas inline editors
 * (e.g. `components/grid/editors/Inline*.tsx`) use absolute positioning to anchor
 * inside the spreadsheet container, which is the canvas's positioned ancestor —
 * canvas-relative coords are correct there. New DOM popups should use
 * `position: 'fixed'` + page coords (the F-1 standardization), and that path
 * IS flagged.
 */
const PORTAL_OR_FIXED_PATTERNS: RegExp[] = [
  /PopoverAnchor/,
  /createVirtualRef/,
  /new\s+DOMRect/,
  /position:\s*['"]fixed['"]/,
];

const VIEWPORT_COORD_REGEX = /\b(cellToViewport|rangeToViewport)\b/;
const PAGE_COORD_REGEX = /\b(getCellPageBounds|getRangePageBounds)\b/;

describe('Overlay canvas/page coordinate boundary guard', () => {
  it('OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH is empty', () => {
    // Goal state: every overlay routes through getCellPageBounds/getRangePageBounds.
    // If this fails, the file in question was added to the legacy list — flip it
    // to the page-coord API instead.
    expect(OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH).toEqual([]);
  });

  // Only iterate if the legacy list has entries — Jest's `it.each` rejects empty arrays.
  // The empty case is already covered by the assertion above.
  const transitional = OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH;
  if (transitional.length > 0) {
    it.each(transitional)('%s still uses legacy offset math (transitional)', (relativeFilePath) => {
      const filePath = path.join(SPREADSHEET_SRC, relativeFilePath);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');

      const usesViewportCoords = VIEWPORT_COORD_REGEX.test(content);
      expect(usesViewportCoords).toBe(true);

      const hasOffsetConversion = LEGACY_OFFSET_PATTERNS.some((p) => p.test(content));
      expect(hasOffsetConversion).toBe(true);
    });
  }

  it('all DOM overlays positioning over the canvas use the page-coord API', () => {
    /**
     * Scan the components directory for files that:
     * 1. Use cellToViewport or rangeToViewport, AND
     * 2. Are positioning themselves as a DOM overlay (Radix Portal,
     * position: 'fixed', or className="...absolute...").
     *
     * Such a file MUST EITHER:
     * (a) be listed in OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH (transitional), OR
     * (b) NOT use cellToViewport/rangeToViewport at the boundary (the
     * expected steady state — use getCellPageBounds/getRangePageBounds).
     *
     * The accepted shape is (b). Listing in (a) is a deprecation surface.
     */
    const componentsDir = path.join(SPREADSHEET_SRC, 'components');
    const tsxFiles = findTsxFiles(componentsDir);

    const unaccountedFiles: { file: string; reason: string }[] = [];

    for (const filePath of tsxFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');

      const usesViewportCoords = VIEWPORT_COORD_REGEX.test(stripComments(content));
      if (!usesViewportCoords) continue;

      const positionsAsDomOverlay = PORTAL_OR_FIXED_PATTERNS.some((p) => p.test(content));
      if (!positionsAsDomOverlay) continue;

      const relative = path.relative(SPREADSHEET_SRC, filePath);
      const usesPageCoordApi = PAGE_COORD_REGEX.test(content);

      if (OVERLAY_FILES_WITH_LEGACY_OFFSET_MATH.includes(relative)) {
        // Allowed transitional path — already declared above.
        continue;
      }

      if (usesPageCoordApi) {
        // Legacy reference inside a comment or near-by code is fine as long
        // as the file is also using the page-coord API.
        continue;
      }

      unaccountedFiles.push({
        file: relative,
        reason:
          'uses cellToViewport/rangeToViewport with DOM-overlay positioning (Portal/fixed/absolute) ' +
          'but does not call getCellPageBounds/getRangePageBounds. ' +
          'Switch to the page-coord API on GridRenderer.',
      });
    }

    if (unaccountedFiles.length > 0) {
      throw new Error(
        `Found ${unaccountedFiles.length} overlay file(s) that should use the ` +
          `page-coord API (gridRenderer.getCellPageBounds / getRangePageBounds) ` +
          `instead of canvas-relative cellToViewport/rangeToViewport:\n` +
          unaccountedFiles.map(({ file, reason }) => ` - ${file}\n ${reason}`).join('\n'),
      );
    }
  });
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Recursively find all .tsx files under a directory, skipping __tests__/node_modules.
 */
function findTsxFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
      results.push(...findTsxFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Crude comment stripper so the lint doesn't trip on `// see cellToViewport`-style
 * historical references. Removes /* ... *\/ blocks and // line comments.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}
