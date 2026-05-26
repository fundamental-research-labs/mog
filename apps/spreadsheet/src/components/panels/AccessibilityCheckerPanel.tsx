/**
 * AccessibilityCheckerPanel Component
 *
 * Side panel that displays accessibility issues found in the spreadsheet.
 * Groups issues by severity (Errors, Warnings, Tips) using accordion sections.
 *
 * The accessibility checker must itself be accessible:
 * - Panel: role="complementary" and aria-label="Accessibility Checker"
 * - Issue lists: role="list" with role="listitem" for each issue
 * - Loading state: announced with aria-live="polite"
 * - Keyboard: Tab through issues, Enter to navigate
 *
 * Architecture:
 * - Uses dispatch() for all actions (close, navigate)
 * - Container handles conditional rendering based on UIStore state
 * - Wrapped with React.memo to prevent unnecessary re-renders
 *
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import { useAccessibilityChecker } from '../../hooks/settings/use-accessibility-checker';
import { useUIStore, useUIStoreApi } from '../../infra/context';
import { AccordionRoot, Button, EmptyState } from '@mog/shell/components/ui';
import { AccessibilityCategorySection } from './AccessibilityCategorySection';

// =============================================================================
// Types
// =============================================================================

/**
 * Panel status from UIStore accessibilityPanel slice
 */
type PanelStatus = 'idle' | 'checking' | 'completed';

/**
 * Grouped issues by severity
 */
interface GroupedIssues {
  errors: AccessibilityIssue[];
  warnings: AccessibilityIssue[];
  tips: AccessibilityIssue[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Group issues by severity level
 */
function groupIssuesBySeverity(issues: AccessibilityIssue[]): GroupedIssues {
  const grouped: GroupedIssues = {
    errors: [],
    warnings: [],
    tips: [],
  };

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        grouped.errors.push(issue);
        break;
      case 'warning':
        grouped.warnings.push(issue);
        break;
      case 'tip':
        grouped.tips.push(issue);
        break;
    }
  }

  return grouped;
}

/**
 * Format summary text for the summary bar
 */
function formatSummary(grouped: GroupedIssues): string {
  const parts: string[] = [];

  if (grouped.errors.length > 0) {
    parts.push(`${grouped.errors.length} ${grouped.errors.length === 1 ? 'Error' : 'Errors'}`);
  }
  if (grouped.warnings.length > 0) {
    parts.push(
      `${grouped.warnings.length} ${grouped.warnings.length === 1 ? 'Warning' : 'Warnings'}`,
    );
  }
  if (grouped.tips.length > 0) {
    parts.push(`${grouped.tips.length} ${grouped.tips.length === 1 ? 'Tip' : 'Tips'}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No issues found';
}

/**
 * Get default expanded categories (errors always expanded if present)
 */
function getDefaultExpandedCategories(grouped: GroupedIssues): string[] {
  const expanded: string[] = [];

  if (grouped.errors.length > 0) {
    expanded.push('error');
  }
  if (grouped.warnings.length > 0 && grouped.errors.length === 0) {
    expanded.push('warning');
  }
  if (grouped.tips.length > 0 && grouped.errors.length === 0 && grouped.warnings.length === 0) {
    expanded.push('tip');
  }

  return expanded;
}

// =============================================================================
// Loading Spinner
// =============================================================================

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div
        className="w-8 h-8 border-2 border-ss-border border-t-ss-primary rounded-full animate-spin"
        role="progressbar"
        aria-label="Checking accessibility"
      />
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * AccessibilityCheckerPanel - Displays accessibility issues in a side panel.
 *
 * Features:
 * - Header with title and close button
 * - Summary bar showing issue counts
 * - Accordion sections for Errors, Warnings, Tips
 * - Loading state with spinner
 * - Empty state when no issues found
 * - "Check again" button to re-run analysis
 */
export const AccessibilityCheckerPanel = memo(function AccessibilityCheckerPanel() {
  const uiStore = useUIStoreApi();

  // Use the accessibility checker hook for check logic and auto-refresh
  // This hook handles:
  // - Running the check when the panel opens
  // - Auto-refresh on document changes via EventBus subscriptions
  // - Cancellation via AbortController when panel closes
  const { runCheck } = useAccessibilityChecker();

  // Subscribe to accessibilityChecker state from UIStore
  const status = useUIStore((s) => s.accessibilityChecker?.status ?? 'idle') as PanelStatus;
  const issues = useUIStore((s) => s.accessibilityChecker?.issues ?? []) as AccessibilityIssue[];
  const selectedIssueId = useUIStore((s) => s.accessibilityChecker?.selectedIssueId ?? null);
  const expandedCategories = useUIStore((s) => s.accessibilityChecker?.expandedCategories ?? []);

  // Ref for live region announcements
  const liveRegionRef = useRef<HTMLDivElement>(null);

  // Group issues by severity
  const groupedIssues = useMemo(() => groupIssuesBySeverity(issues), [issues]);

  // Summary text
  const summaryText = useMemo(() => formatSummary(groupedIssues), [groupedIssues]);

  // Default expanded categories (if not set in store)
  const defaultExpanded = useMemo(
    () =>
      expandedCategories.length > 0
        ? expandedCategories
        : getDefaultExpandedCategories(groupedIssues),
    [expandedCategories, groupedIssues],
  );

  // Handle close button - use UIStore action directly since it's not a dispatchable action
  const handleClose = useCallback(() => {
    uiStore.getState().closeAccessibilityPanel();
  }, [uiStore]);

  // Handle issue selection - use UIStore action and navigate to issue location
  const handleSelectIssue = useCallback(
    (issueId: string) => {
      // Select the issue in the store
      uiStore.getState().selectAccessibilityIssue(issueId);

      // Find the issue and navigate to its location
      const issue = issues.find((i) => i.id === issueId);
      if (issue) {
        // TODO: Navigate to issue location using selection/navigation APIs
        // For now, just select the issue in the panel
        // Future: dispatch('NAVIGATE_TO_CELL', deps, { ref: issue.location.ref, sheetId: issue.location.sheetId })
      }
    },
    [uiStore, issues],
  );

  // Handle check again button - directly calls runCheck from the hook
  const handleCheckAgain = useCallback(() => {
    runCheck();
  }, [runCheck]);

  // Handle keyboard shortcut to close (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Announce status changes to screen readers
  useEffect(() => {
    if (liveRegionRef.current) {
      if (status === 'checking') {
        liveRegionRef.current.textContent = 'Checking accessibility...';
      } else if (status === 'completed') {
        liveRegionRef.current.textContent = `Accessibility check complete. ${summaryText}`;
      }
    }
  }, [status, summaryText]);

  const hasIssues = issues.length > 0;
  const isLoading = status === 'checking';

  return (
    <aside
      role="complementary"
      aria-label="Accessibility Checker"
      className="flex flex-col w-[320px] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      {/* Screen reader live region for announcements */}
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <h2 className="text-subtitle font-semibold text-ss-text m-0">Accessibility</h2>
        <button
          type="button"
          onClick={handleClose}
          className={[
            'flex items-center justify-center',
            'w-7 h-7 p-0',
            'border-none rounded-full',
            'bg-transparent',
            'cursor-pointer',
            'text-section text-ss-text-secondary',
            'hover:bg-ss-surface-hover',
            'focus-visible:ring-2 focus-visible:ring-ss-border-focus focus-visible:ring-inset',
            'outline-none',
            'transition-colors duration-ss-fast',
          ].join(' ')}
          aria-label="Close Accessibility Checker (Escape)"
          title="Close (Esc)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      {/* Summary bar */}
      {!isLoading && status === 'completed' && (
        <div
          className={[
            'px-4 py-2',
            'border-b border-ss-border',
            'text-body-sm font-medium',
            hasIssues ? 'text-ss-text' : 'text-ss-success',
            'bg-ss-surface-secondary',
          ].join(' ')}
        >
          {summaryText}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state */}
        {isLoading && <LoadingSpinner />}

        {/* Empty state */}
        {!isLoading && status === 'completed' && !hasIssues && (
          <EmptyState
            icon="checkmark"
            title="No accessibility issues found!"
            description="Your spreadsheet is accessible to users with disabilities."
            className="py-8"
          />
        )}

        {/* Issues accordion */}
        {!isLoading && hasIssues && (
          <div className="p-3">
            <AccordionRoot type="multiple" defaultValue={defaultExpanded}>
              <AccessibilityCategorySection
                severity="error"
                issues={groupedIssues.errors}
                selectedIssueId={selectedIssueId}
                onSelectIssue={handleSelectIssue}
              />
              <AccessibilityCategorySection
                severity="warning"
                issues={groupedIssues.warnings}
                selectedIssueId={selectedIssueId}
                onSelectIssue={handleSelectIssue}
              />
              <AccessibilityCategorySection
                severity="tip"
                issues={groupedIssues.tips}
                selectedIssueId={selectedIssueId}
                onSelectIssue={handleSelectIssue}
              />
            </AccordionRoot>
          </div>
        )}

        {/* Idle state - prompt to check */}
        {status === 'idle' && (
          <div className="p-4 text-center">
            <p className="text-body-sm text-ss-text-secondary mb-4">
              Click "Check" to analyze your spreadsheet for accessibility issues.
            </p>
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="px-4 py-3 border-t border-ss-border bg-ss-surface-secondary shrink-0">
        <Button
          variant="secondary"
          className="w-full"
          onClick={handleCheckAgain}
          disabled={isLoading}
        >
          {isLoading ? 'Checking...' : status === 'completed' ? 'Check Again' : 'Check'}
        </Button>
      </div>
    </aside>
  );
});
