/**
 * Clipboard paste action handlers.
 *
 * This module owns paste-specific action behavior so the copy/cut data
 * gathering code in clipboard.ts does not keep growing.
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { PasteSpecialOptions } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';

import { unifiedPaste } from '../../domain/clipboard';
import { blobToDataUrl } from '../../utils/blob-to-data-url';
import {
  getActiveClipboardPaste,
  trackActiveClipboardPaste,
  waitForPendingClipboardPaste,
} from '../../systems/grid-editing/coordination/pending-clipboard-paste';
import { waitForPendingClipboardCapture } from '../../systems/grid-editing/coordination/pending-clipboard-capture';
import { pasteChartFromClipboard } from './chart-clipboard';
import { getUIStore, handled } from './handler-utils';

function deferred(): ActionResult {
  return { handled: false, reason: 'disabled' };
}

function isEditing(deps: ActionDependencies): boolean {
  return deps.accessors.editor.isEditing() || deps.accessors.editor.isImeComposing();
}

function cloneRange(range: CellRange | null | undefined): CellRange | null {
  if (!range) return null;
  return {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
  };
}

function getPasteTargetRange(deps: ActionDependencies): CellRange | null {
  return cloneRange(deps.accessors.selection.getRanges()[0]);
}

function runTrackedClipboardPaste(
  deps: ActionDependencies,
  operation: () => Promise<ActionResult>,
): Promise<ActionResult> {
  if (isEditing(deps)) {
    return Promise.resolve(deferred());
  }

  let pastePromise: Promise<ActionResult>;
  try {
    pastePromise = operation();
  } catch (error) {
    pastePromise = Promise.reject(error);
  }
  trackActiveClipboardPaste(pastePromise);
  return pastePromise;
}

function createUnifiedPasteDeps(deps: ActionDependencies) {
  return {
    getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
    commands: deps.commands.clipboard,
    getTargetRange: () => getPasteTargetRange(deps),
    waitForPasteCommit: waitForPendingClipboardPaste,
  };
}

async function runUnifiedPasteAction(
  deps: ActionDependencies,
  options: PasteSpecialOptions | undefined,
  announcement: string,
): Promise<ActionResult> {
  const activeCell = deps.accessors.selection.getActiveCell();
  await unifiedPaste(activeCell, createUnifiedPasteDeps(deps), options);
  getUIStore(deps).getState().announce(announcement, 'polite');
  return handled();
}

/**
 * Paste from clipboard (Ctrl+V).
 */
export const PASTE: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () => runPaste(deps));

const runPaste: AsyncActionHandler = async (deps) => {
  await waitForPendingClipboardCapture();

  const uiStore = getUIStore(deps);
  if (uiStore.getState().hasChartInClipboard()) {
    return pasteChartFromClipboard(deps);
  }

  const activeCell = deps.accessors.selection.getActiveCell();
  await unifiedPaste(activeCell, {
    ...createUnifiedPasteDeps(deps),
    suppressNextUndo: () => uiStore.getState().suppressNextUndo(),
    pasteImage: async (blob, anchorCell) => {
      const sheetId = deps.getActiveSheetId();
      const ws = deps.workbook.getSheetById(sheetId);
      const dataUrl = await blobToDataUrl(blob);
      await ws.pictures.add({
        src: dataUrl,
        anchorCell: { row: anchorCell.row, col: anchorCell.col },
      });
    },
  });

  uiStore.getState().announce('Pasted', 'polite');
  return handled();
};

/**
 * Clear clipboard state (ESC key in grid mode).
 */
export const CLEAR_CLIPBOARD: ActionHandler = (deps) => {
  if (deps.accessors.selection.isResizingHeader()) {
    deps.commands.selection.cancelResize();
    return handled();
  }

  const drawBorderAccessor = deps.accessors.drawBorder;
  const drawBorderCommands = deps.commands.drawBorder;
  if (drawBorderAccessor && drawBorderCommands) {
    const isDrawBorderActive = drawBorderAccessor.isActive();

    if (isDrawBorderActive) {
      drawBorderCommands.cancel();
      return handled();
    }
  }

  deps.commands.selection.exitAllModes();

  const activePaste = getActiveClipboardPaste();
  if (activePaste) {
    void activePaste.finally(() => {
      deps.commands.clipboard.clear();
    });
    return handled();
  }

  deps.commands.clipboard.clear();
  return handled();
};

export const SHOW_PASTE_OPTIONS: ActionHandler = (deps, payload) => {
  if (!payload?.range || !payload?.sheetId) {
    return { handled: false, reason: 'disabled' };
  }
  getUIStore(deps).getState().showPasteOptionsButton(payload.range, payload.sheetId);
  return handled();
};

export const HIDE_PASTE_OPTIONS: ActionHandler = (deps) => {
  getUIStore(deps).getState().hidePasteOptionsButton();
  return handled();
};

export const PASTE_WITH_OPTIONS: ActionHandler = (deps, payload) => {
  if (!payload?.option) {
    return { handled: false, reason: 'disabled' };
  }

  const uiStore = getUIStore(deps);
  const { range, sheetId } = uiStore.getState().pasteOptions;

  if (!range || !sheetId) {
    return { handled: false, reason: 'disabled' };
  }

  deps.commands.clipboard.pasteWithOption(payload.option, range, sheetId);
  uiStore.getState().hidePasteOptionsButton();

  return handled();
};

export const PASTE_VALUES: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () =>
    runUnifiedPasteAction(deps, { values: true }, 'Pasted values'),
  );

export const PASTE_FORMULAS: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () =>
    runUnifiedPasteAction(deps, { formulas: true }, 'Pasted formulas'),
  );

export const PASTE_FORMATTING: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () =>
    runUnifiedPasteAction(deps, { formats: true }, 'Pasted formatting'),
  );

export const PASTE_TRANSPOSE: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () =>
    runUnifiedPasteAction(deps, { transpose: true }, 'Pasted with transpose'),
  );

export const PASTE_LINK: AsyncActionHandler = (deps) =>
  runTrackedClipboardPaste(deps, () =>
    runUnifiedPasteAction(deps, { pasteLink: true }, 'Pasted as link'),
  );

export const PASTE_AS_PICTURE: ActionHandler = (deps) => {
  if (isEditing(deps)) {
    return deferred();
  }

  getUIStore(deps).getState().announce('Paste as picture not yet implemented', 'polite');
  return handled();
};

export const PASTE_AS_LINKED_PICTURE: ActionHandler = (deps) => {
  if (isEditing(deps)) {
    return deferred();
  }

  getUIStore(deps).getState().announce('Paste as linked picture not yet implemented', 'polite');
  return handled();
};

export const SHOW_PASTE_SIZE_MISMATCH_DIALOG: ActionHandler = (deps, payload) => {
  if (!payload?.sourceSize || !payload?.targetSize || !payload?.pendingData) {
    return { handled: false, reason: 'disabled' };
  }

  getUIStore(deps)
    .getState()
    .openPasteMismatchDialog(payload.sourceSize, payload.targetSize, payload.pendingData);

  return handled();
};

export const CONFIRM_PASTE_SIZE_MISMATCH: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  const { pendingPasteData } = uiStore.getState().pasteMismatchDialog;

  if (!pendingPasteData) {
    uiStore.getState().closePasteMismatchDialog();
    return handled();
  }

  uiStore.getState().closePasteMismatchDialog();
  deps.commands.clipboard.paste(
    pendingPasteData.targetCell,
    true,
    undefined,
    pendingPasteData.targetRange,
  );

  return handled();
};

export const CANCEL_PASTE_SIZE_MISMATCH: ActionHandler = (deps) => {
  getUIStore(deps).getState().closePasteMismatchDialog();
  return handled();
};

export const CONFIRM_PASTE_OVERWRITE: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  const { pendingData } = uiStore.getState().pasteOverwriteConfirmDialog;

  uiStore.getState().closePasteOverwriteConfirmDialog();

  if (!pendingData) {
    return handled();
  }

  if (pendingData.pasteOptions) {
    deps.commands.clipboard.pasteSpecial(
      pendingData.targetCell,
      pendingData.pasteOptions,
      true,
      true,
    );
  } else {
    deps.commands.clipboard.paste(pendingData.targetCell, true, true);
  }

  return handled();
};

export const CANCEL_PASTE_OVERWRITE: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closePasteOverwriteConfirmDialog();
  deps.commands.clipboard.clear();
  return handled();
};
