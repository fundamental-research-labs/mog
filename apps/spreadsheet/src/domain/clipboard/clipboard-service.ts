/**
 * Clipboard Service
 *
 * High-level service for clipboard operations using the canonical ClipboardPayload format.
 * Wraps the existing ClipboardMachine and provides methods for:
 * - System clipboard read/write
 * - Internal clipboard management
 * - Cross-view clipboard operations
 *
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { cellsToHTML, cellsToTSV, htmlToCells, tsvToCells } from './serializers';
import type {
  ClipboardOperation,
  ClipboardPayload,
  ClipboardServiceState,
  SystemClipboardData,
} from './types';

// =============================================================================
// Clipboard Service
// =============================================================================

/**
 * Service for managing clipboard operations across views.
 *
 * Responsibilities:
 * 1. Maintain internal clipboard state (ClipboardPayload)
 * 2. Read from / write to system clipboard
 * 3. Handle copy/cut/paste lifecycle
 *
 * Usage:
 * ```typescript
 * const service = new ClipboardService();
 *
 * // Copy from a view
 * const payload = kanbanView.getClipboardPayload();
 * await service.copyToSystem(payload);
 *
 * // Paste to a view
 * const data = await service.readFromSystem();
 * if (gridView.canPaste(data)) {
 * gridView.paste(data);
 * }
 * ```
 */
export class ClipboardService {
  // ═══════════════════════════════════════════════════════════════════════════
  // Internal State
  // ═══════════════════════════════════════════════════════════════════════════

  /** Current internal clipboard payload */
  private internalPayload: ClipboardPayload | null = null;

  /** Current operation type */
  private operation: ClipboardOperation | null = null;

  /** Whether cut has been consumed (cut is single-use) */
  private cutConsumed: boolean = false;

  /** Signature to detect if system clipboard was overwritten */
  private textSignature: string | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // System Clipboard Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Write a ClipboardPayload to the system clipboard.
   *
   * @param payload - The canonical clipboard data
   * @param operation - 'copy' or 'cut'
   */
  async copyToSystem(
    payload: ClipboardPayload,
    operation: ClipboardOperation = 'copy',
  ): Promise<void> {
    // Store internally
    this.internalPayload = payload;
    this.operation = operation;
    this.cutConsumed = false;
    this.textSignature = payload.text;

    // Write to system clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        // Modern API - supports multiple formats
        const items: ClipboardItem[] = [];

        const blobs: Record<string, Blob> = {
          'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        };

        if (payload.html) {
          blobs['text/html'] = new Blob([payload.html], { type: 'text/html' });
        }

        items.push(new ClipboardItem(blobs));
        await navigator.clipboard.write(items);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        // Fallback to text-only
        await navigator.clipboard.writeText(payload.text);
      } else {
        // Legacy fallback
        this.legacyCopyToClipboard(payload.text, payload.html);
      }
    } catch (err) {
      console.warn('Failed to write to system clipboard:', err);
      // Internal clipboard still set, paste will use that
    }
  }

  /**
   * Read from the system clipboard and convert to ClipboardPayload.
   *
   * If the system clipboard text matches our signature, returns the rich internal data.
   * Otherwise, parses the external clipboard content.
   */
  async readFromSystem(): Promise<ClipboardPayload | null> {
    try {
      const systemData = await this.readSystemClipboard();

      // Check if this is our own clipboard data
      if (systemData.text && systemData.text === this.textSignature && this.internalPayload) {
        // System clipboard matches our internal data - use rich format
        // Check if cut was already consumed
        if (this.operation === 'cut' && this.cutConsumed) {
          return null;
        }
        return this.internalPayload;
      }

      // External clipboard - parse into ClipboardPayload
      return this.parseExternalClipboard(systemData);
    } catch (err) {
      console.warn('Failed to read from system clipboard:', err);

      // Fall back to internal clipboard if available
      if (this.internalPayload && !(this.operation === 'cut' && this.cutConsumed)) {
        return this.internalPayload;
      }
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal Clipboard Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set the internal clipboard without writing to system clipboard.
   * Useful for view-internal operations.
   */
  setInternal(payload: ClipboardPayload, operation: ClipboardOperation = 'copy'): void {
    this.internalPayload = payload;
    this.operation = operation;
    this.cutConsumed = false;
    this.textSignature = payload.text;
  }

  /**
   * Get the current internal clipboard payload.
   * Returns null if cut was already consumed.
   */
  getInternal(): ClipboardPayload | null {
    if (this.operation === 'cut' && this.cutConsumed) {
      return null;
    }
    return this.internalPayload;
  }

  /**
   * Check if internal clipboard has data.
   */
  hasInternal(): boolean {
    if (this.operation === 'cut' && this.cutConsumed) {
      return false;
    }
    return this.internalPayload !== null;
  }

  /**
   * Mark cut operation as consumed.
   * Called after successful paste of cut data.
   */
  consumeCut(): void {
    if (this.operation === 'cut') {
      this.cutConsumed = true;
    }
  }

  /**
   * Check if current operation is a cut.
   */
  isCut(): boolean {
    return this.operation === 'cut' && !this.cutConsumed;
  }

  /**
   * Get the current clipboard state.
   */
  getState(): ClipboardServiceState {
    return {
      payload: this.internalPayload,
      operation: this.operation,
      cutConsumed: this.cutConsumed,
    };
  }

  /**
   * Clear the internal clipboard.
   */
  clear(): void {
    this.internalPayload = null;
    this.operation = null;
    this.cutConsumed = false;
    this.textSignature = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payload Creation Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a ClipboardPayload from cell values.
   * Convenience method for views to create canonical format.
   */
  static createPayload(
    values: CellValue[][],
    options?: {
      formats?: (Partial<CellFormat> | null)[][];
      tableContext?: ClipboardPayload['tableContext'];
      source?: ClipboardPayload['source'];
    },
  ): ClipboardPayload {
    const rowCount = values.length;
    const colCount = rowCount > 0 ? Math.max(...values.map((row) => row.length)) : 0;

    // Normalize rows to same column count
    const normalizedValues = values.map((row) => {
      const normalized = [...row];
      while (normalized.length < colCount) {
        normalized.push(null);
      }
      return normalized;
    });

    // Generate text and HTML
    const text = cellsToTSV(normalizedValues);
    const html = cellsToHTML(normalizedValues, options?.formats);

    return {
      cells: {
        values: normalizedValues,
        formats: options?.formats,
        rowCount,
        colCount,
      },
      tableContext: options?.tableContext,
      source: options?.source ?? {
        viewType: 'grid',
        viewId: null,
        sheetId: null,
      },
      text,
      html,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read from system clipboard.
   */
  private async readSystemClipboard(): Promise<SystemClipboardData> {
    if (navigator.clipboard && navigator.clipboard.read) {
      // Modern API
      try {
        const items = await navigator.clipboard.read();
        let text = '';
        let html: string | undefined;

        for (const item of items) {
          // Get text
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            text = await blob.text();
          }

          // Get HTML
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            html = await blob.text();
          }
        }

        return { text, html };
      } catch {
        // Fall back to readText
      }
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      return { text };
    }

    // Legacy fallback - can't read programmatically
    return { text: '' };
  }

  /**
   * Parse external clipboard data into ClipboardPayload.
   */
  private parseExternalClipboard(data: SystemClipboardData): ClipboardPayload | null {
    if (!data.text && !data.html) {
      return null;
    }

    // Try HTML first (preserves formatting)
    if (data.html) {
      const parsed = htmlToCells(data.html);
      if (parsed && parsed.rowCount > 0) {
        return {
          cells: {
            values: parsed.values,
            formats: parsed.formats,
            rowCount: parsed.rowCount,
            colCount: parsed.colCount,
          },
          source: {
            viewType: 'grid',
            viewId: null,
            sheetId: null,
          },
          text: data.text || cellsToTSV(parsed.values),
          html: data.html,
        };
      }
    }

    // Fall back to TSV
    if (data.text) {
      const parsed = tsvToCells(data.text);
      if (parsed.rowCount > 0) {
        return {
          cells: {
            values: parsed.values,
            rowCount: parsed.rowCount,
            colCount: parsed.colCount,
          },
          source: {
            viewType: 'grid',
            viewId: null,
            sheetId: null,
          },
          text: data.text,
        };
      }
    }

    return null;
  }

  /**
   * Legacy clipboard write using execCommand.
   */
  private legacyCopyToClipboard(text: string, html?: string): void {
    // Create temporary element
    const el = document.createElement('div');
    el.innerHTML = html || text.replace(/\n/g, '<br>').replace(/\t/g, '&emsp;');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.setAttribute('contenteditable', 'true');

    document.body.appendChild(el);

    // Select and copy
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      document.execCommand('copy');
    } catch (err) {
      console.warn('Legacy clipboard copy failed:', err);
    }

    document.body.removeChild(el);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Global clipboard service instance.
 * Views can import this directly for clipboard operations.
 */
export const clipboardService = new ClipboardService();
