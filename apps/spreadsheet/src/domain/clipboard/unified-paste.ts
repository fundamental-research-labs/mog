/**
 * Unified Clipboard Operations
 *
 * The SINGLE algorithms for clipboard operations (copy, cut, paste).
 * These functions ensure consistent behavior whether triggered via:
 * - Toolbar buttons
 * - Keyboard shortcuts (Ctrl+C/X/V via action handlers)
 * - Context menus
 * - Programmatic API
 *
 * Why unified operations?
 * Keyboard shortcuts intercept keydown events BEFORE browser fires native clipboard events.
 * When action handlers return `handled()`, preventDefault/stopPropagation are called,
 * so useClipboardEvents handlers NEVER run. Without unified operations, keyboard
 * shortcuts would fail to properly copy/cut/paste.
 *
 * ARCHITECTURE:
 * - This module is framework-agnostic (no React dependencies)
 * - It bridges the action system with the clipboard state machine
 * - Paste handles async clipboard read before routing
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 1 (Unified Action System)
 */

import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors';
import { clipboardSelectors } from '../../selectors';
import type {
  ClipboardCommands,
  ClipboardData,
  ClipboardState,
  PasteSpecialOptions,
} from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { readPasteDefaultsPreference } from '../../infra/state/paste-defaults-store';
import {
  resolveDefaultPasteOptions,
  shouldNoopExternalFormatsPaste,
  type PasteDefaultContext,
} from './paste-defaults';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Dependencies for unified paste operation.
 * These are provided by the caller (action handler or hook).
 */
export interface UnifiedPasteDeps {
  /** Get clipboard state snapshot for reading */
  getClipboardSnapshot: () => ClipboardState;
  /** Commands for sending events to clipboard machine */
  commands: ClipboardCommands;
  /**
   * Insert an image blob as a floating picture anchored at the given cell.
   * Optional — only the regular-paste paths (PASTE handler, pasteToSelection
   * hook) wire this. Paste-special variants (values/formulas/formats/transpose
   * /link) and tab-enter auto-paste deliberately omit it: an image-only
   * clipboard has no "values" or "formulas" to paste, so those paths no-op
   * silently when the clipboard contains only images.
   */
  pasteImage?: (blob: Blob, anchorCell: CellCoord) => Promise<void>;
  /**
   * Wait until the clipboard machine's paste side effect has committed.
   * `unifiedPaste` only routes the paste event; spreadsheet mutations run in
   * the grid-editing paste integration after the machine enters `pasting`.
   */
  waitForPasteCommit?: () => Promise<void>;
  /** Read the persisted user default for normal paste. */
  readPasteDefaultsPreference?: () => unknown;
}

/**
 * MIME types we treat as floating-image paste payloads. Ordered so that
 * lossless raster formats are preferred when multiple are present on the
 * clipboard. SVG is included so vector clipboard items don't silently drop;
 * we treat it as a regular image (data-URL src).
 */
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
] as const;

function normalizeClipboardSignature(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
}

function resolveNormalPasteOptions(
  deps: UnifiedPasteDeps,
  context: PasteDefaultContext,
): PasteSpecialOptions | undefined {
  const resolved = resolveDefaultPasteOptions(
    (deps.readPasteDefaultsPreference ?? readPasteDefaultsPreference)(),
    context,
  );
  return resolved.appliesDefault ? resolved.options : undefined;
}

async function routePasteCommand(command: () => void, deps: UnifiedPasteDeps): Promise<void> {
  command();
  await deps.waitForPasteCommit?.();
}

/**
 * Dependencies for unified copy/cut operations.
 * These are provided by the caller (action handler or hook).
 */
export interface UnifiedCopyCutDeps {
  /** Commands for sending events to clipboard machine */
  commands: ClipboardCommands;
  /** Function to build clipboard data from ranges */
  buildData: (ranges: CellRange[]) => ClipboardData;
  /** Function to generate TSV for system clipboard and text signature */
  generateTSV: (ranges: CellRange[]) => string;
  /** Function to generate HTML for system clipboard */
  generateHTML: (ranges: CellRange[]) => string;
}

// =============================================================================
// UNIFIED PASTE IMPLEMENTATION
// =============================================================================

/**
 * Unified paste implementation - the SINGLE algorithm for all paste operations.
 *
 * This function implements the correct paste logic:
 * 1. Reads the system clipboard (async)
 * 2. Compares it with our internal clipboard signature
 * 3. Routes to the appropriate paste method (internal or external)
 *
 * Why this exists:
 * - The PASTE action handler can't use native browser events (they're intercepted)
 * - We need to detect if the user copied from another app after our copy
 * - The clipboard state machine expects a targetCell, which the trigger methods don't provide
 *
 * @param activeCell - The cell to paste to (typically the current selection's active cell)
 * @param deps - Dependencies for clipboard access
 * @param options - Optional paste special options (values only, formulas only, etc.)
 */
export async function unifiedPaste(
  activeCell: CellCoord,
  deps: UnifiedPasteDeps,
  options?: PasteSpecialOptions,
): Promise<void> {
  const initialClipboardState = deps.getClipboardSnapshot();
  const initialClipboardData = clipboardSelectors.data(initialClipboardState);
  let pendingPreviewShown = false;
  if (initialClipboardData) {
    deps.commands.showPastePreview(activeCell);
    pendingPreviewShown = true;
  }
  const hidePendingPreview = () => {
    if (!pendingPreviewShown) return;
    deps.commands.hidePastePreview();
    pendingPreviewShown = false;
  };

  // 1. Read system clipboard (async operation).
  // Prefer the full Clipboard API (navigator.clipboard.read) so we can pick
  // up the `text/html` payload alongside `text/plain`. The HTML payload
  // carries inline formatting (bold/italic/fill) from other apps (Excel,
  // Google Sheets, browsers), which the TSV fallback strips.
  // Falls back to readText when the full API is unavailable or blocked.
  let systemText = '';
  let systemHTML: string | undefined;
  let imageBlob: Blob | undefined;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!systemHTML && item.types.includes('text/html')) {
          try {
            const blob = await item.getType('text/html');
            systemHTML = await blob.text();
          } catch {
            // HTML read failed — keep going, plain text still works.
          }
        }
        if (!systemText && item.types.includes('text/plain')) {
          try {
            const blob = await item.getType('text/plain');
            systemText = await blob.text();
          } catch {
            // Ignore and try readText below.
          }
        }
        if (!imageBlob) {
          for (const mime of IMAGE_MIME_TYPES) {
            if (item.types.includes(mime)) {
              try {
                imageBlob = await item.getType(mime);
                break;
              } catch {
                // Try next MIME type — some browsers expose the type
                // but reject getType() (e.g. permission edge cases).
              }
            }
          }
        }
      }
    }
    if (!systemText && navigator.clipboard?.readText) {
      systemText = await navigator.clipboard.readText();
    }
  } catch {
    // Clipboard access denied - fall through to use internal clipboard if available
  }

  // 1b. Image-only paste: clipboard has an image and no cell text/HTML.
  // Routing priority matches Excel — when a clipboard item carries both
  // a rendered image AND text/HTML (Excel itself does this when copying
  // a range), the user wants the cell data, not a screenshot. So image
  // paste only fires when there's no text content at all.
  if (imageBlob && !systemText && !systemHTML && deps.pasteImage) {
    resolveDefaultPasteOptions(
      (deps.readPasteDefaultsPreference ?? readPasteDefaultsPreference)(),
      {
        sourceKind: 'external-image',
      },
    );
    hidePendingPreview();
    await deps.pasteImage(imageBlob, activeCell);
    return;
  }

  // 2. Compare with our internal clipboard signature
  const clipboardState = deps.getClipboardSnapshot();
  const clipboardData = clipboardSelectors.data(clipboardState);
  const isCut = clipboardSelectors.isCut(clipboardState);

  // If system clipboard matches our text signature, use rich internal data (preserves formulas, formats)
  // Empty string check prevents matching when both are empty
  const internalSignature = clipboardData?.textSignature
    ? normalizeClipboardSignature(clipboardData.textSignature)
    : '';
  const systemSignature = normalizeClipboardSignature(systemText);
  const hasFreshInternalClipboard =
    Boolean(clipboardData?.textSignature) &&
    clipboardData?.sourceSheetId !== EXTERNAL_SOURCE_SHEET_ID &&
    clipboardState.context.isStale !== true;
  const isOurClipboard =
    (internalSignature === systemSignature && systemSignature !== '') || hasFreshInternalClipboard;

  // 3. Route to appropriate paste method
  if (clipboardData && isOurClipboard) {
    if (clipboardData.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID) {
      const resolvedOptions =
        options ??
        resolveNormalPasteOptions(deps, {
          sourceKind: 'external-text',
          hasExternalText: true,
        });
      if (shouldNoopExternalFormatsPaste(resolvedOptions)) {
        hidePendingPreview();
        return;
      }
      await routePasteCommand(
        () =>
          deps.commands.externalPaste({
            text: clipboardData.textSignature ?? systemText,
            targetCell: activeCell,
            options: resolvedOptions,
          }),
        deps,
      );
    } else if (options) {
      await routePasteCommand(() => deps.commands.pasteSpecial(activeCell, options), deps);
    } else if (isCut) {
      resolveDefaultPasteOptions(
        (deps.readPasteDefaultsPreference ?? readPasteDefaultsPreference)(),
        {
          sourceKind: 'internal-cut',
          hasInternalRichData: true,
        },
      );
      await routePasteCommand(() => deps.commands.paste(activeCell), deps);
    } else {
      const resolvedOptions = resolveNormalPasteOptions(deps, {
        sourceKind: 'internal-copy',
        hasInternalRichData: true,
      });
      if (resolvedOptions) {
        await routePasteCommand(
          () => deps.commands.pasteSpecial(activeCell, resolvedOptions),
          deps,
        );
      } else {
        await routePasteCommand(() => deps.commands.paste(activeCell), deps);
      }
    }
    return;
  }

  // 4. External data - parse and paste.
  // If HTML is present, hand it to externalPaste so the state machine can
  // recover per-cell formatting (bold/italic/fill) via parseHTML. The TSV
  // text remains for signature comparison and as a fallback when the HTML
  // doesn't contain a table.
  if (systemText || systemHTML) {
    const resolvedOptions =
      options ??
      resolveNormalPasteOptions(deps, {
        sourceKind: systemHTML ? 'external-html' : 'external-text',
        hasExternalHtml: Boolean(systemHTML),
        hasExternalText: Boolean(systemText),
      });
    if (shouldNoopExternalFormatsPaste(resolvedOptions, systemHTML)) {
      hidePendingPreview();
      return;
    }
    await routePasteCommand(
      () =>
        deps.commands.externalPaste({
          text: systemText,
          targetCell: activeCell,
          html: systemHTML,
          options: resolvedOptions,
        }),
      deps,
    );
    return;
  }

  // 5. Fallback: system clipboard read failed but internal clipboard has data
  // This handles headless browsers, permission denied, or other clipboard API failures
  // where systemText stays empty but we still have valid internal clipboard data.
  if (clipboardData && systemText === '') {
    if (clipboardData.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID) {
      const resolvedOptions =
        options ??
        resolveNormalPasteOptions(deps, {
          sourceKind: 'external-text',
          hasExternalText: true,
        });
      if (shouldNoopExternalFormatsPaste(resolvedOptions)) {
        hidePendingPreview();
        return;
      }
      await routePasteCommand(
        () =>
          deps.commands.externalPaste({
            text: clipboardData.textSignature ?? '',
            targetCell: activeCell,
            options: resolvedOptions,
          }),
        deps,
      );
    } else if (options) {
      await routePasteCommand(() => deps.commands.pasteSpecial(activeCell, options), deps);
    } else if (isCut) {
      resolveDefaultPasteOptions(
        (deps.readPasteDefaultsPreference ?? readPasteDefaultsPreference)(),
        {
          sourceKind: 'internal-cut',
          hasInternalRichData: true,
        },
      );
      await routePasteCommand(() => deps.commands.paste(activeCell), deps);
    } else {
      const resolvedOptions = resolveNormalPasteOptions(deps, {
        sourceKind: 'internal-copy',
        hasInternalRichData: true,
      });
      if (resolvedOptions) {
        await routePasteCommand(
          () => deps.commands.pasteSpecial(activeCell, resolvedOptions),
          deps,
        );
      } else {
        await routePasteCommand(() => deps.commands.paste(activeCell), deps);
      }
    }
  }
}

// =============================================================================
// UNIFIED COPY IMPLEMENTATION
// =============================================================================

/**
 * Unified copy implementation - the SINGLE algorithm for all copy operations.
 *
 * This function:
 * 1. Builds clipboard data from the current selection
 * 2. Generates TSV/HTML for system clipboard
 * 3. Writes to system clipboard (for cross-app paste)
 * 4. Sends COPY event with full data to clipboard machine
 *
 * @param ranges - The ranges to copy (typically from current selection)
 * @param deps - Dependencies for building data and clipboard access
 */
export async function unifiedCopy(ranges: CellRange[], deps: UnifiedCopyCutDeps): Promise<void> {
  if (!ranges || ranges.length === 0) return;

  // Build clipboard data from store context
  const data = deps.buildData(ranges);

  // Generate clipboard formats for system clipboard
  const tsv = deps.generateTSV(ranges);
  const html = deps.generateHTML(ranges);

  // Store text signature for external clipboard detection
  data.textSignature = tsv;

  // Send to XState clipboard machine with full data FIRST
  // This must happen before the async clipboard write so internal state
  // is available immediately (the action handler is fire-and-forget)
  deps.commands.copy(ranges, data);

  // Write to system clipboard for cross-app paste (best-effort, may fail in headless)
  await writeToSystemClipboard({ tsv, html });
}

// =============================================================================
// UNIFIED CUT IMPLEMENTATION
// =============================================================================

/**
 * Unified cut implementation - the SINGLE algorithm for all cut operations.
 *
 * This function:
 * 1. Builds clipboard data from the current selection
 * 2. Generates TSV/HTML for system clipboard
 * 3. Writes to system clipboard (for cross-app paste)
 * 4. Sends CUT event with full data to clipboard machine
 *
 * @param ranges - The ranges to cut (typically from current selection)
 * @param deps - Dependencies for building data and clipboard access
 */
export async function unifiedCut(ranges: CellRange[], deps: UnifiedCopyCutDeps): Promise<void> {
  if (!ranges || ranges.length === 0) return;

  // Build clipboard data from store context
  const data = deps.buildData(ranges);

  // Generate clipboard formats for system clipboard
  const tsv = deps.generateTSV(ranges);
  const html = deps.generateHTML(ranges);

  // Store text signature for external clipboard detection
  data.textSignature = tsv;

  // Send to XState clipboard machine with full data FIRST
  // This must happen before the async clipboard write so internal state
  // is available immediately (the action handler is fire-and-forget)
  deps.commands.cut(ranges, data);

  // Write to system clipboard for cross-app paste (best-effort, may fail in headless)
  await writeToSystemClipboard({ tsv, html });
}

// =============================================================================
// HELPER: Write to System Clipboard
// =============================================================================

/**
 * Write to system clipboard with both TSV and HTML formats.
 * This enables paste into other applications like Excel.
 *
 * Accepts either a Promise or raw data. When called with a Promise,
 * uses ClipboardItem with promise-based Blobs so that the clipboard
 * slot is reserved synchronously (within user activation window) while
 * the actual data arrives later when the promise resolves.
 *
 * MUST be called synchronously within user activation when using the
 * promise overload — the browser requires user activation at the time
 * of the `navigator.clipboard.write()` call, not when data arrives.
 *
 * Errors propagate to the caller — no silent swallowing.
 */
export async function writeToSystemClipboard(
  dataOrPromise: Promise<{ tsv: string; html: string }> | { tsv: string; html: string },
): Promise<void> {
  const dataPromise =
    dataOrPromise instanceof Promise ? dataOrPromise : Promise.resolve(dataOrPromise);

  if (navigator.clipboard?.write) {
    // Modern Clipboard API: ClipboardItem with promise-based Blobs.
    // The clipboard slot is reserved NOW (synchronous, within user activation).
    // The Blob promises resolve later when async bridge work completes.
    const textBlobPromise = dataPromise.then(({ tsv }) => new Blob([tsv], { type: 'text/plain' }));
    const htmlBlobPromise = dataPromise.then(({ html }) => new Blob([html], { type: 'text/html' }));

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': textBlobPromise,
        'text/html': htmlBlobPromise,
      }),
    ]);
  } else if (navigator.clipboard) {
    // Fallback to text-only (waits for data)
    const { tsv } = await dataPromise;
    await navigator.clipboard.writeText(tsv);
  }
}
