/**
 * AccessibilityIssueItem Component
 *
 * A single accessibility issue row within the AccessibilityCategorySection.
 * Displays issue title, location, and handles click navigation.
 *
 * Accessibility requirements:
 * - role="listitem" for proper list semantics
 * - Clear focus indicator for keyboard navigation
 * - Clickable to navigate to issue location
 *
 */

import { memo, useCallback } from 'react';

import type {
  AccessibilityIssue,
  AccessibilityIssueSeverity,
} from '@mog-sdk/contracts/accessibility';
// =============================================================================
// Types
// =============================================================================

export interface AccessibilityIssueItemProps {
  /** The accessibility issue to display */
  issue: AccessibilityIssue;
  /** Whether this issue is currently selected */
  isSelected: boolean;
  /** Callback when this issue is clicked */
  onSelect: (issueId: string) => void;
}

// =============================================================================
// Severity Icons
// =============================================================================

/**
 * Error icon - filled circle with X
 */
function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" />
      <path
        fill="white"
        d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Warning icon - triangle with exclamation
 */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1L15 14H1L8 1Z" />
      <path fill="white" d="M7.25 6V9.5H8.75V6H7.25ZM7.25 10.5V12H8.75V10.5H7.25Z" />
    </svg>
  );
}

/**
 * Tip icon - lightbulb
 */
function TipIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1C5.243 1 3 3.243 3 6c0 1.657.806 3.126 2.045 4.036.32.235.455.628.455 1.014v1.45c0 .828.672 1.5 1.5 1.5h2c.828 0 1.5-.672 1.5-1.5v-1.45c0-.386.135-.779.455-1.014C12.194 9.126 13 7.657 13 6c0-2.757-2.243-5-5-5zm-1 14h2v1H7v-1z" />
    </svg>
  );
}

/**
 * Get the icon component for a severity level
 */
function SeverityIcon({
  severity,
  className,
}: {
  severity: AccessibilityIssueSeverity;
  className?: string;
}) {
  switch (severity) {
    case 'error':
      return <ErrorIcon className={className} />;
    case 'warning':
      return <WarningIcon className={className} />;
    case 'tip':
      return <TipIcon className={className} />;
  }
}

/**
 * Get the color class for a severity level
 */
function getSeverityColorClass(severity: AccessibilityIssueSeverity): string {
  switch (severity) {
    case 'error':
      return 'text-ss-error';
    case 'warning':
      return 'text-ss-warning';
    case 'tip':
      return 'text-ss-info';
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * AccessibilityIssueItem - Displays a single accessibility issue.
 *
 * Features:
 * - Severity icon with appropriate color
 * - Issue title and location
 * - Keyboard accessible (Enter/Space to navigate)
 * - Focus visible ring
 * - Selected state styling
 */
export const AccessibilityIssueItem = memo(function AccessibilityIssueItem({
  issue,
  isSelected,
  onSelect,
}: AccessibilityIssueItemProps) {
  // Handle click/keyboard navigation
  const handleClick = useCallback(() => {
    onSelect(issue.id);
  }, [issue.id, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(issue.id);
      }
    },
    [issue.id, onSelect],
  );

  // Format location display
  const locationDisplay =
    issue.location.ref || issue.location.objectId
      ? `${issue.location.sheetName}!${issue.location.ref || issue.location.objectId}`
      : issue.location.sheetName;

  return (
    <button
      role="listitem"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        // Layout
        'flex items-start gap-2 w-full text-left',
        // Padding
        'px-3 py-2',
        // Border
        'border-b border-ss-border last:border-b-0',
        // Typography
        'text-body-sm',
        // Interaction
        'cursor-pointer',
        'outline-none',
        // Hover state
        'hover:bg-ss-surface-hover',
        // Focus ring
        'focus-visible:ring-2 focus-visible:ring-ss-border-focus focus-visible:ring-inset',
        // Selected state
        isSelected ? 'bg-ss-primary-light' : 'bg-transparent',
        // Transition
        'transition-colors duration-ss-fast',
      ].join(' ')}
      aria-current={isSelected ? 'true' : undefined}
    >
      {/* Severity icon */}
      <div className={`shrink-0 pt-0.5 ${getSeverityColorClass(issue.severity)}`}>
        <SeverityIcon severity={issue.severity} className="w-4 h-4" />
      </div>

      {/* Issue content */}
      <div className="flex-1 min-w-0">
        {/* Title */}
        <div className="text-ss-text font-medium truncate">{issue.title}</div>

        {/* Location */}
        <div className="text-ss-text-secondary text-caption truncate">{locationDisplay}</div>
      </div>
    </button>
  );
});
