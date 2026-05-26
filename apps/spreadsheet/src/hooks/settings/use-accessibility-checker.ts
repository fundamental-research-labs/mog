/**
 * Accessibility Checker Hook
 *
 * Provides access to the accessibility checker state and actions.
 * This hook:
 * - Subscribes to EventBus for auto-refresh when panel is open
 * - Uses AbortController for cancellation when panel closes during check
 * - Debounces auto-refresh checks (500ms)
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 5: EventBus subscriptions
 */

import { useCallback, useEffect, useRef } from 'react';

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { SpreadsheetEventType } from '@mog-sdk/contracts/events';

import { runAccessibilityCheck } from '../../domain/accessibility';
import { useUIStore, useUIStoreApi, useWorkbook } from '../../infra/context';

// =============================================================================
// Constants
// =============================================================================

/**
 * Debounce delay for auto-refresh checks when content changes.
 * 500ms is a reasonable balance between responsiveness and performance.
 */
const AUTO_REFRESH_DEBOUNCE_MS = 500;

/**
 * Events that trigger an auto-refresh of accessibility issues when the panel is open.
 * These events indicate changes that could affect accessibility.
 */
const AUTO_REFRESH_EVENTS: SpreadsheetEventType[] = [
  'cell:changed',
  'cells:batch-changed',
  'cell:format-changed',
  'floatingObject:updated',
  'floatingObject:deleted',
  'chart:created',
  'chart:updated',
  'chart:deleted',
  'table:created',
  'table:updated',
  'table:deleted',
  'sheet:renamed',
  'merges:changed',
];

// =============================================================================
// Types
// =============================================================================

export interface UseAccessibilityCheckerReturn {
  /** Whether the accessibility checker panel is open */
  isOpen: boolean;
  /** Current check status ('idle' | 'checking' | 'completed') */
  status: 'idle' | 'checking' | 'completed';
  /** List of accessibility issues found */
  issues: AccessibilityIssue[];
  /** Currently selected issue ID */
  selectedIssueId: string | null;
  /** Open the panel and run a check */
  openAndCheck: () => void;
  /** Close the panel */
  close: () => void;
  /** Navigate to a specific issue */
  navigateToIssue: (issueId: string) => void;
  /** Run a new check */
  runCheck: () => Promise<void>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for the accessibility checker panel.
 *
 * ARCHITECTURE:
 * - Hook OWNS EventBus subscriptions (creates/destroys)
 * - AbortSignal for cancellation when panel closes during check
 * - Debounced auto-refresh when panel is open
 *
 * @returns Accessibility checker state and actions
 */
export function useAccessibilityChecker(): UseAccessibilityCheckerReturn {
  const wb = useWorkbook();
  const uiStoreApi = useUIStoreApi();

  // Get state from UIStore using selectors for efficient re-renders
  const isOpen = useUIStore((s) => s.accessibilityChecker.isOpen);
  const status = useUIStore((s) => s.accessibilityChecker.status);
  const issues = useUIStore((s) => s.accessibilityChecker.issues);
  const selectedIssueId = useUIStore((s) => s.accessibilityChecker.selectedIssueId);

  // Refs for cleanup and debouncing
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Run the accessibility check.
   * Uses AbortController for cancellation.
   */
  const runCheck = useCallback(async () => {
    // Cancel any in-progress check
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Set status to checking
    uiStoreApi.getState().setAccessibilityCheckStatus('checking');

    try {
      // Run the check — floating object reads now go through Worksheet.objects API
      const result = await runAccessibilityCheck(wb, {
        signal: abortController.signal,
        onProgress: (_percent: number) => {
          // Could update progress in UIStore if needed
          // For now, just log for debugging
        },
      });

      // Only update if not aborted
      if (!result.aborted) {
        uiStoreApi.getState().setAccessibilityIssues(result.issues);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Check was cancelled, don't update state
        return;
      }
      console.error('[useAccessibilityChecker] Error during check:', error);
      uiStoreApi.getState().setAccessibilityCheckStatus('completed');
    }
  }, [wb, uiStoreApi]);

  /**
   * Open the panel and run a check.
   */
  const openAndCheck = useCallback(() => {
    uiStoreApi.getState().openAccessibilityPanel();
    // Schedule the check for next microtask to ensure panel is open first
    queueMicrotask(() => {
      runCheck();
    });
  }, [uiStoreApi, runCheck]);

  /**
   * Close the panel.
   * Cancels any in-progress check.
   */
  const close = useCallback(() => {
    // Cancel any in-progress check
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    uiStoreApi.getState().closeAccessibilityPanel();
  }, [uiStoreApi]);

  /**
   * Navigate to a specific issue.
   */
  const navigateToIssue = useCallback(
    (issueId: string) => {
      const state = uiStoreApi.getState();
      state.selectAccessibilityIssue(issueId);

      // Find the issue
      const issue = state.accessibilityChecker.issues.find(
        (i: AccessibilityIssue) => i.id === issueId,
      );
      if (!issue) return;

      // Switch sheet if needed
      const currentSheetId = state.activeSheetId;
      if (issue.location.sheetId !== currentSheetId) {
        state.setActiveSheet(issue.location.sheetId);
      }

      // Navigation to the specific location is handled by
      // the NAVIGATE_TO_ACCESSIBILITY_ISSUE action handler
      // which has access to deps.commands.selection
    },
    [uiStoreApi],
  );

  /**
   * Debounced auto-refresh function.
   */
  const debouncedRefresh = useCallback(() => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      // Only run if panel is still open (read fresh state)
      if (uiStoreApi.getState().accessibilityChecker.isOpen) {
        runCheck();
      }
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }, [runCheck, uiStoreApi]);

  /**
   * Subscribe to wb.on for auto-refresh when panel is open.
   * CRITICAL: Must clean up subscriptions on unmount.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Subscribe to all auto-refresh events individually
    const unsubscribes = AUTO_REFRESH_EVENTS.map((event) =>
      wb.on(event, () => {
        debouncedRefresh();
      }),
    );

    // Cleanup: unsubscribe all and cancel pending debounce
    return () => {
      unsubscribes.forEach((unsub) => unsub());
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, [isOpen, wb, debouncedRefresh]);

  /**
   * Cleanup abort controller on unmount.
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, []);

  /**
   * Run check when panel first opens.
   */
  useEffect(() => {
    if (isOpen && status === 'checking' && issues.length === 0) {
      runCheck();
    }
  }, [isOpen, status, issues.length, runCheck]);

  return {
    isOpen,
    status,
    issues,
    selectedIssueId,
    openAndCheck,
    close,
    navigateToIssue,
    runCheck,
  };
}
