/**
 * useSheetProtection Hook
 *
 * Provides reactive sheet protection status.
 * Subscribes to EventBus for real-time updates when protection state changes.
 *
 * Editor & Protection
 */

import { useCallback, useEffect, useState } from 'react';

import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';
import type { SheetId, SheetSettings } from '@mog-sdk/contracts/core';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseSheetProtectionReturn {
  /** Current protection state */
  protection: {
    /** Whether the sheet is protected */
    isProtected: boolean;
    /** Protection options (what operations are allowed) */
    options: SheetProtectionOptions;
    /** Whether the sheet has a password set */
    hasPassword: boolean;
  };
}

export interface SheetProtectionPermissions {
  formatCells: boolean;
  formatRows: boolean;
  formatColumns: boolean;
  insertRows: boolean;
  insertColumns: boolean;
  deleteRows: boolean;
  deleteColumns: boolean;
  editObject: boolean;
}

export interface UseAllSheetsProtectionReturn {
  /** Check if a specific sheet is protected */
  isSheetProtected: (sheetId: SheetId) => boolean;
  /** Version counter that increments when any sheet protection changes */
  protectionVersion: number;
}

// =============================================================================
// Helpers
// =============================================================================

function deriveProtection(settings: SheetSettings): UseSheetProtectionReturn['protection'] {
  return {
    isProtected: settings.isProtected,
    options: (settings.protectionOptions ?? {}) as SheetProtectionOptions,
    hasPassword: !!settings.protectionPasswordHash,
  };
}

function derivePermissions(settings: SheetSettings): SheetProtectionPermissions {
  if (!settings.isProtected) {
    return {
      formatCells: true,
      formatRows: true,
      formatColumns: true,
      insertRows: true,
      insertColumns: true,
      deleteRows: true,
      deleteColumns: true,
      editObject: true,
    };
  }

  const options = settings.protectionOptions;
  return {
    formatCells: options?.formatCells ?? false,
    formatRows: options?.formatRows ?? false,
    formatColumns: options?.formatColumns ?? false,
    insertRows: options?.insertRows ?? false,
    insertColumns: options?.insertColumns ?? false,
    deleteRows: options?.deleteRows ?? false,
    deleteColumns: options?.deleteColumns ?? false,
    editObject: options?.editObjects ?? false,
  };
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for managing single sheet protection with reactive EventBus subscription.
 *
 * - Sync init from `wb.mirror.getSheetSettings(sheetId)` — first paint correct.
 * - Live updates via the `sheet:settings-changed` event.
 *
 * Used by ReviewRibbon to show protection status for the active sheet.
 *
 * @param sheetId - The sheet ID to get protection status for
 * @returns Protection state for the sheet
 */
export function useSheetProtection(sheetId: SheetId): UseSheetProtectionReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror.
  const [protection, setProtection] = useState<UseSheetProtectionReturn['protection']>(() =>
    deriveProtection(wb.mirror.getSheetSettings(sheetId)),
  );

  // Subscribe to ws.on for protection changes
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change.
    setProtection(deriveProtection(wb.mirror.getSheetSettings(sheetId)));

    // Subscribe to sheet:settings-changed events.
    // React to all three protection-related keys; re-derive from the mirror
    // so partial updates (e.g. protectionPasswordHash flipping while
    // isProtected stays true, or protectionOptions changing alone) propagate.
    const unsubscribe = ws.on('sheet:settings-changed', (event) => {
      if (
        event.changedKey === 'isProtected' ||
        event.changedKey === 'protectionPasswordHash' ||
        event.changedKey === 'protectionOptions'
      ) {
        setProtection(deriveProtection(wb.mirror.getSheetSettings(sheetId)));
      }
    });

    return unsubscribe;
  }, [wb, sheetId]);

  return {
    protection,
  };
}

/**
 * Hook for tracking protection status across all sheets.
 *
 * This uses a version counter pattern to trigger re-renders when ANY sheet's
 * protection status changes. Used by TabStrip to show lock icons on protected sheets.
 *
 * Pattern:
 * - `isSheetProtected(sheetId)` reads from the kernel state mirror synchronously.
 * - Version counter increments on any `sheet:settings-changed` event whose
 * `changedKey` is one of the protection keys (`isProtected`,
 * `protectionPasswordHash`, `protectionOptions`). The increment forces
 * consumers to re-render and re-call `isSheetProtected`, which then sees
 * the post-mutation mirror.
 *
 * @returns Protection checker function and version counter
 */
export function useAllSheetsProtection(): UseAllSheetsProtectionReturn {
  const wb = useWorkbook();
  const [protectionVersion, setProtectionVersion] = useState(0);

  // Subscribe to wb.on for any sheet protection changes
  useEffect(() => {
    const unsubscribe = wb.on('sheet:settings-changed', (event) => {
      if (
        event.changedKey === 'isProtected' ||
        event.changedKey === 'protectionPasswordHash' ||
        event.changedKey === 'protectionOptions'
      ) {
        setProtectionVersion((v) => v + 1);
      }
    });

    return unsubscribe;
  }, [wb]);

  // Sync read from mirror — no async fetch, no per-sheet cache.
  const isSheetProtected = useCallback(
    (sheetId: SheetId): boolean => {
      return wb.mirror.getSheetSettings(sheetId).isProtected;
    },
    [wb],
  );

  return {
    isSheetProtected,
    protectionVersion,
  };
}

export function useSheetProtectionPermissions(sheetId: SheetId): SheetProtectionPermissions {
  const wb = useWorkbook();
  const [permissions, setPermissions] = useState<SheetProtectionPermissions>(() =>
    derivePermissions(wb.mirror.getSheetSettings(sheetId)),
  );

  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    setPermissions(derivePermissions(wb.mirror.getSheetSettings(sheetId)));

    const unsubscribe = ws.on('sheet:settings-changed', (event) => {
      if (event.changedKey === 'isProtected' || event.changedKey === 'protectionOptions') {
        setPermissions(derivePermissions(wb.mirror.getSheetSettings(sheetId)));
      }
    });

    return unsubscribe;
  }, [wb, sheetId]);

  return permissions;
}
