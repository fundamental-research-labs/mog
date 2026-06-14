import { useCallback, useEffect, type RefObject } from 'react';

import { EXTERNAL_SOURCE_SHEET_ID, type ClipboardData } from '@mog-sdk/contracts/actors';
import type { ClipboardState } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';

import { writeToSystemClipboard } from '../../domain/clipboard';
import {
  resolveDefaultPasteOptions,
  shouldNoopExternalFormatsPaste,
} from '../../domain/clipboard/paste-defaults';
import { useActiveSheetId, useReadOnly, useWorkbook } from '../../infra/context';
import { readPasteDefaultsPreference } from '../../infra/state/paste-defaults-store';
import { clipboardSelectors } from '../../selectors';
import { waitForPendingClipboardPaste } from '../../systems/grid-editing/coordination/pending-clipboard-paste';
import {
  trackPendingClipboardCapture,
  waitForPendingClipboardCapture,
} from '../../systems/grid-editing/coordination/pending-clipboard-capture';
import { blobToDataUrl } from '../../utils/blob-to-data-url';
import { useCoordinator } from '../shared/use-coordinator';
import { prefetchClipboardData } from './clipboard-prefetch';

function normalizeClipboardSignature(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
}

function htmlHasClipboardPayload(html: string | undefined): boolean {
  if (!html?.trim()) return false;
  if (/<(?:td|th)\b/i.test(html)) return true;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ');
  return normalizeClipboardSignature(text).trim() !== '';
}

function isOurClipboardData(
  clipboardState: ClipboardState,
  clipboardData: ClipboardData | null,
  systemText: string,
  hasExternalSystemPayload = normalizeClipboardSignature(systemText) !== '',
): boolean {
  const internalSignature = clipboardData?.textSignature
    ? normalizeClipboardSignature(clipboardData.textSignature)
    : '';
  const systemSignature = normalizeClipboardSignature(systemText);
  const hasFreshInternalClipboard =
    Boolean(clipboardData) &&
    clipboardData?.sourceSheetId !== EXTERNAL_SOURCE_SHEET_ID &&
    clipboardState.context.isStale !== true;

  return (
    (internalSignature === systemSignature && systemSignature !== '') ||
    (!hasExternalSystemPayload && hasFreshInternalClipboard)
  );
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

async function sendClipboardPasteCommand(command: () => void): Promise<void> {
  command();
  await waitForPendingClipboardPaste();
}

export interface UseClipboardEventsOptions {
  enabled?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onPaste?: (cellCount: number) => void;
  onCopy?: () => void;
  onCut?: () => void;
  onError?: (error: Error) => void;
}

export interface UseClipboardEventsReturn {
  isActive: boolean;
  pasteFromSystemClipboard: () => Promise<number>;
}

export function useClipboardEvents(options: UseClipboardEventsOptions): UseClipboardEventsReturn {
  const { enabled = true, containerRef, onPaste, onCopy, onCut, onError } = options;

  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.clipboard;
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const readOnly = useReadOnly();
  const commands = coordinator.grid.access.commands.clipboard;

  const handleCopy = useCallback(
    async (event: ClipboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) {
        let selectedText = '';
        if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
          const start = activeEl.selectionStart ?? 0;
          const end = activeEl.selectionEnd ?? 0;
          selectedText = activeEl.value.substring(start, end);
        } else {
          selectedText = window.getSelection()?.toString() ?? '';
        }
        if (selectedText) {
          commands.editModeCopy(selectedText);
        }
        return;
      }

      event.preventDefault();

      try {
        const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
        const ranges = selectionSnapshot.ranges;
        if (!ranges || ranges.length === 0) return;

        const mutableRanges = [...ranges] as CellRange[];
        const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);
        const data = prefetched.buildData(mutableRanges);
        const tsv = prefetched.generateTSV(mutableRanges);
        const html = prefetched.generateHTML(mutableRanges);

        data.textSignature = tsv;
        commands.copy(mutableRanges, data);
        onCopy?.();

        await writeToSystemClipboard({ tsv, html });
      } catch (err) {
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:COPY', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, activeSheetId, wb, commands, onCopy, onError],
  );

  const handleCut = useCallback(
    async (event: ClipboardEvent) => {
      if (readOnly) {
        event.preventDefault();
        return;
      }
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) {
        let selectedText = '';
        if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
          const start = activeEl.selectionStart ?? 0;
          const end = activeEl.selectionEnd ?? 0;
          selectedText = activeEl.value.substring(start, end);
        } else {
          selectedText = window.getSelection()?.toString() ?? '';
        }
        if (selectedText) {
          commands.editModeCopy(selectedText);
        }
        return;
      }

      event.preventDefault();

      try {
        const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
        const ranges = selectionSnapshot.ranges;
        if (!ranges || ranges.length === 0) return;

        const mutableRanges = [...ranges] as CellRange[];
        const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);
        const data = prefetched.buildData(mutableRanges);
        const tsv = prefetched.generateTSV(mutableRanges);
        const html = prefetched.generateHTML(mutableRanges);

        data.textSignature = tsv;
        commands.cut(mutableRanges, data);
        onCut?.();

        await writeToSystemClipboard({ tsv, html });
      } catch (err) {
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:CUT', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, activeSheetId, wb, commands, onCut, onError, readOnly],
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (readOnly) {
        event.preventDefault();
        return;
      }
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      event.preventDefault();

      try {
        await waitForPendingClipboardCapture();

        const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
        const activeCell = selectionSnapshot.activeCell;
        const targetRange = cloneRange(selectionSnapshot.ranges[0]);

        const systemText = event.clipboardData?.getData('text/plain') ?? '';
        const html = event.clipboardData?.getData('text/html') ?? '';
        const files = event.clipboardData?.files;
        const hasExternalSystemPayload =
          normalizeClipboardSignature(systemText) !== '' ||
          htmlHasClipboardPayload(html) ||
          Boolean(files && Array.from(files).some((file) => file.type.startsWith('image/')));

        const clipboardState = actor.getSnapshot();
        const clipboardData = clipboardSelectors.data(clipboardState);
        const isOurClipboard = isOurClipboardData(
          clipboardState,
          clipboardData,
          systemText,
          hasExternalSystemPayload,
        );

        if (clipboardData && isOurClipboard) {
          const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
            sourceKind: clipboardSelectors.isCut(clipboardState) ? 'internal-cut' : 'internal-copy',
            hasInternalRichData: true,
          });
          if (resolved.appliesDefault) {
            await sendClipboardPasteCommand(() =>
              commands.pasteSpecial(
                activeCell,
                resolved.options,
                undefined,
                undefined,
                targetRange,
              ),
            );
          } else {
            await sendClipboardPasteCommand(() =>
              commands.paste(activeCell, undefined, undefined, targetRange),
            );
          }
          if (clipboardData.sourceRanges && clipboardData.sourceRanges.length > 0) {
            const range = clipboardData.sourceRanges[0];
            const count = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
            onPaste?.(count);
          }
          return;
        }

        let text = systemText;
        if (!text) {
          try {
            text = await navigator.clipboard.readText();
          } catch {
            // Clipboard access denied.
          }
        }

        if (text || html) {
          const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
            sourceKind: html ? 'external-html' : 'external-text',
            hasExternalHtml: Boolean(html),
            hasExternalText: Boolean(text),
          });
          const resolvedOptions = resolved.appliesDefault ? resolved.options : undefined;
          if (shouldNoopExternalFormatsPaste(resolvedOptions, html || undefined)) return;
          await sendClipboardPasteCommand(() =>
            commands.externalPaste({
              text,
              targetCell: activeCell,
              targetRange,
              html: html || undefined,
              options: resolvedOptions,
            }),
          );
          onPaste?.(1);
          return;
        }

        if (!text && !html && files && files.length > 0) {
          const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
          if (imageFile) {
            const ws = wb.getSheetById(activeSheetId);
            const dataUrl = await blobToDataUrl(imageFile);
            await ws.pictures.add({
              src: dataUrl,
              anchorCell: { row: activeCell.row, col: activeCell.col },
            });
            onPaste?.(1);
          }
        }
      } catch (err) {
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:PASTE', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, actor, commands, onPaste, onError, readOnly, wb, activeSheetId],
  );

  const pasteFromSystemClipboard = useCallback(async (): Promise<number> => {
    if (readOnly) return 0;
    await waitForPendingClipboardCapture();

    const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
    const activeCell = selectionSnapshot.activeCell;
    const targetRange = cloneRange(selectionSnapshot.ranges[0]);

    let systemText = '';
    try {
      systemText = await navigator.clipboard.readText();
    } catch {
      // Clipboard access denied.
    }

    const clipboardState = actor.getSnapshot();
    const clipboardData = clipboardSelectors.data(clipboardState);
    const isOurClipboard = isOurClipboardData(clipboardState, clipboardData, systemText);

    if (clipboardData && isOurClipboard) {
      const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
        sourceKind: clipboardSelectors.isCut(clipboardState) ? 'internal-cut' : 'internal-copy',
        hasInternalRichData: true,
      });
      if (resolved.appliesDefault) {
        await sendClipboardPasteCommand(() =>
          commands.pasteSpecial(activeCell, resolved.options, undefined, undefined, targetRange),
        );
      } else {
        await sendClipboardPasteCommand(() =>
          commands.paste(activeCell, undefined, undefined, targetRange),
        );
      }
      if (clipboardData.sourceRanges && clipboardData.sourceRanges.length > 0) {
        const range = clipboardData.sourceRanges[0];
        return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      }
      return 0;
    }

    if (systemText) {
      const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
        sourceKind: 'external-text',
        hasExternalText: true,
      });
      const resolvedOptions = resolved.appliesDefault ? resolved.options : undefined;
      if (shouldNoopExternalFormatsPaste(resolvedOptions)) return 0;
      await sendClipboardPasteCommand(() =>
        commands.externalPaste({
          text: systemText,
          targetCell: activeCell,
          targetRange,
          options: resolvedOptions,
        }),
      );
      return 1;
    }

    return 0;
  }, [coordinator, actor, commands, readOnly]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const copyHandler = (e: Event) => {
      const promise = handleCopy(e as ClipboardEvent);
      trackPendingClipboardCapture(promise);
      void promise;
    };
    const cutHandler = (e: Event) => {
      const promise = handleCut(e as ClipboardEvent);
      trackPendingClipboardCapture(promise);
      void promise;
    };
    const pasteHandler = (e: Event) => {
      void handlePaste(e as ClipboardEvent);
    };

    container.addEventListener('copy', copyHandler);
    container.addEventListener('cut', cutHandler);
    container.addEventListener('paste', pasteHandler);

    return () => {
      container.removeEventListener('copy', copyHandler);
      container.removeEventListener('cut', cutHandler);
      container.removeEventListener('paste', pasteHandler);
    };
  }, [enabled, containerRef, handleCopy, handleCut, handlePaste]);

  return {
    isActive: enabled,
    pasteFromSystemClipboard,
  };
}
