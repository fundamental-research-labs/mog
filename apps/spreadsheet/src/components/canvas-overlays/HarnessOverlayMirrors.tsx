/**
 * HarnessOverlayMirrors
 *
 * Some overlay surfaces (validation circles, flash-fill ghost preview) are
 * rendered exclusively on the canvas. The audit
 * (`dev/app-eval/audit/AUDIT-SUMMARY.md`) found that specs assert on these
 * surfaces by reading UIStore state directly inside `page.evaluate(...)`,
 * which the lint flags. The right fix is a Playwright observer
 * (`getValidationCircles`, `getFlashFillPreviewCells`) that reads the
 * RENDERED state through DOM — not UIStore.
 *
 * Since the canvas itself isn't a DOM mirror, we render an invisible DOM
 * shadow of each overlay's per-cell positions. The mirror reads the same
 * UIStore state the renderer does, so it stays in sync without any new
 * coupling. Each shadow node carries `data-testid`, `data-row`, and
 * `data-col` so the harness observer can collect positions via
 * `document.querySelectorAll(...)`.
 *
 * The mirror is `aria-hidden`, has zero size, and is `pointer-events: none`
 * — it never affects layout, accessibility, or hit-testing.
 *
 */

import { memo } from 'react';

import { useUIStore } from '../../internal-api';
import type { FlashFillPreviewValue } from '../../ui-store/slices/editing/flash-fill';

// =============================================================================
// Validation circles mirror
// =============================================================================

/**
 * Invisible DOM mirror of `validationCircleCells` for the active sheet.
 *
 * Renders one `<span data-testid="validation-circle">` per cell that has a
 * red-oval validation circle drawn on the canvas. The harness observer
 * (`getValidationCircles`) collects these into `Array<{row, col}>`.
 */
const ValidationCirclesMirror = memo(function ValidationCirclesMirror() {
  const visible = useUIStore((s) => s.validationCirclesVisible);
  const cells = useUIStore((s) => s.validationCircleCells);
  const activeSheetId = useUIStore((s) => s.activeSheetId);

  if (!visible) return null;

  // Filter the cell-key set to the active sheet (keys are "sheetId:row:col").
  const prefix = activeSheetId ? `${activeSheetId}:` : '';
  const out: Array<{ row: number; col: number }> = [];
  for (const key of cells) {
    if (prefix && !key.startsWith(prefix)) continue;
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const row = Number(parts[1]);
    const col = Number(parts[2]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    out.push({ row, col });
  }

  return (
    <div
      data-testid="validation-circles-mirror"
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {out.map(({ row, col }) => (
        <span key={`${row}:${col}`} data-testid="validation-circle" data-row={row} data-col={col} />
      ))}
    </div>
  );
});

// =============================================================================
// Flash-fill preview mirror
// =============================================================================

/**
 * Invisible DOM mirror of the flash-fill ghost preview values.
 *
 * Renders one `<span data-testid="flash-fill-preview-cell">` per ghosted
 * preview cell. The harness observer (`getFlashFillPreviewCells`) collects
 * these into `Array<{row, col, value}>`.
 */
const FlashFillPreviewMirror = memo(function FlashFillPreviewMirror() {
  const isShowingPreview = useUIStore((s) => s.flashFillPreview.isShowingPreview);
  const previewValues = useUIStore((s) => s.flashFillPreview.previewValues);

  if (!isShowingPreview) return null;

  return (
    <div
      data-testid="flash-fill-preview-mirror"
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {previewValues.map((p: FlashFillPreviewValue) => (
        <span
          key={`${p.row}:${p.col}`}
          data-testid="flash-fill-preview-cell"
          data-row={p.row}
          data-col={p.col}
          data-value={typeof p.value === 'string' ? p.value : String(p.value ?? '')}
        />
      ))}
    </div>
  );
});

// =============================================================================
// Combined mount point
// =============================================================================

/**
 * Mounts all canvas-only overlay DOM mirrors used by the app-eval harness.
 *
 * Add a single `<HarnessOverlayMirrors />` to the spreadsheet shell. Each
 * mirror inside is a no-op render when its corresponding overlay is not
 * visible — the production cost is one `useUIStore` subscription per
 * overlay, evaluated only when the overlay's visibility changes.
 */
export const HarnessOverlayMirrors = memo(function HarnessOverlayMirrors() {
  return (
    <>
      <ValidationCirclesMirror />
      <FlashFillPreviewMirror />
    </>
  );
});
