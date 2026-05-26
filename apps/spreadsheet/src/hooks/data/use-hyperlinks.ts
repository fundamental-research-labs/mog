/**
 * Hyperlinks Hook
 *
 * Provides hyperlink interaction functionality:
 * - Opening hyperlinks securely in new tabs
 * - URL validation
 * - Support for various URL schemes (http, https, mailto, tel)
 *
 * Architecture note: Hyperlink activation is a SIDE EFFECT, not a state change.
 * This hook provides utility functions that OptimizedGridV2 calls directly,
 * bypassing the selection state machine when Ctrl+click opens a link.
 *
 * Architecture:
 * - Sync presence check: ws.viewport.getCellData(...).hasHyperlink
 * - URL fetch: ws.hyperlinks.get (async — URL not in binary record)
 * - This hook is read-only (no writes)
 *
 * @see ARCHITECTURE.md - "Coordinator Owns Execution" principle
 */

import { useCallback } from 'react';

import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseHyperlinksReturn {
  /**
   * Whether a cell has a hyperlink (sync, from the binary viewport
   * record). Note: the URL itself is only available via the async
   * `fetchHyperlink` because `hyperlinkUrl` isn't carried in the binary
   * record (see types/viewport reader.ts).
   */
  hasHyperlink: (cell: CellCoord) => boolean;

  /**
   * Fetch the hyperlink URL for a cell (async; goes through the kernel
   * hyperlinks API).
   */
  fetchHyperlink: (cell: CellCoord) => Promise<string | null>;

  /**
   * Open a hyperlink in a new browser tab.
   * Handles URL validation and security (noopener, noreferrer).
   *
   * @param url - The URL to open
   * @returns true if the link was opened, false if validation failed
   */
  openHyperlink: (url: string) => boolean;

  /**
   * Check if a URL is valid and safe to open.
   * Allows: http, https, mailto, tel schemes
   * Blocks: javascript, data, vbscript, and unknown schemes
   *
   * @param url - The URL to validate
   * @returns true if the URL is valid and safe
   */
  isValidHyperlink: (url: string) => boolean;

  /**
   * Handle Ctrl+click on a cell. Returns true (synchronously) iff the
   * cell carries a hyperlink — so the caller can suppress normal
   * click-selection behaviour. The actual link-open dispatch happens
   * asynchronously after a kernel API fetch (the URL string isn't in the
   * binary viewport record).
   *
   * @param cell - The clicked cell
   * @returns true if the cell has a hyperlink (and a navigation has been
   * scheduled), false otherwise
   */
  handleCtrlClick: (cell: CellCoord) => boolean;
}

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Allowed URL schemes for hyperlinks.
 * Security: Block javascript:, data:, vbscript: to prevent XSS attacks.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Check if a URL is valid and safe to open.
 */
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Trim and check for empty string
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return false;
  }

  try {
    // Try to parse as URL
    const parsed = new URL(trimmed);

    // Check if scheme is allowed
    return ALLOWED_SCHEMES.includes(parsed.protocol.toLowerCase());
  } catch {
    // If URL parsing fails, it might be a relative URL or malformed
    // For safety, only allow URLs that can be parsed
    // (relative URLs would need a base, which we don't support for hyperlinks)
    return false;
  }
}

/**
 * Safely open a URL in a new browser tab.
 * Uses noopener and noreferrer for security.
 */
function safeOpenUrl(url: string): boolean {
  if (!isValidUrl(url)) {
    console.warn('[use-hyperlinks] Blocked invalid or unsafe URL:', url);
    return false;
  }

  // Open in new tab with security attributes
  // noopener: prevents window.opener access (security)
  // noreferrer: prevents referrer header (privacy)
  window.open(url.trim(), '_blank', 'noopener,noreferrer');
  return true;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for hyperlink interactions.
 *
 * Usage:
 * ```tsx
 * const { handleCtrlClick, fetchHyperlink, openHyperlink } = useHyperlinks();
 *
 * // In mouse handler:
 * if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
 * if (handleCtrlClick(cell)) {
 * return; // Hyperlink was opened, don't propagate to selection
 * }
 * }
 * ```
 */
export function useHyperlinks(): UseHyperlinksReturn {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // Sync presence check from the binary viewport record. The URL itself
  // is fetched separately via the kernel hyperlinks API.
  const hasHyperlink = useCallback(
    (cell: CellCoord): boolean => {
      return ws.viewport.getCellData(cell.row, cell.col)?.hasHyperlink === true;
    },
    [ws],
  );

  const fetchHyperlink = useCallback(
    async (cell: CellCoord): Promise<string | null> => {
      try {
        return await ws.hyperlinks.get(cell.row, cell.col);
      } catch {
        return null;
      }
    },
    [ws],
  );

  const isValidHyperlink = useCallback((url: string): boolean => {
    return isValidUrl(url);
  }, []);

  const openHyperlink = useCallback((url: string): boolean => {
    return safeOpenUrl(url);
  }, []);

  const handleCtrlClick = useCallback(
    (cell: CellCoord): boolean => {
      if (!hasHyperlink(cell)) return false;
      // Fire-and-forget: fetch URL, then open. We've already returned
      // true synchronously to suppress normal click-selection.
      void (async () => {
        const url = await fetchHyperlink(cell);
        if (url) openHyperlink(url);
      })();
      return true;
    },
    [hasHyperlink, fetchHyperlink, openHyperlink],
  );

  return {
    hasHyperlink,
    fetchHyperlink,
    openHyperlink,
    isValidHyperlink,
    handleCtrlClick,
  };
}
