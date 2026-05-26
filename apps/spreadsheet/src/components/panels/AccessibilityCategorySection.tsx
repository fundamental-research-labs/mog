/**
 * AccessibilityCategorySection Component
 *
 * An accordion section for a category of accessibility issues (Errors, Warnings, Tips).
 * Uses Radix Accordion for accessible expand/collapse behavior.
 *
 * Features:
 * - Expandable/collapsible section
 * - Issue count badge
 * - Severity-specific styling
 * - Contains AccessibilityIssueItem components
 *
 */

import { memo, useMemo } from 'react';

import type {
  AccessibilityIssue,
  AccessibilityIssueSeverity,
} from '@mog-sdk/contracts/accessibility';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@mog/shell/components/ui';
import { AccessibilityIssueItem } from './AccessibilityIssueItem';

// =============================================================================
// Types
// =============================================================================

export interface AccessibilityCategorySectionProps {
  /** The severity level for this section */
  severity: AccessibilityIssueSeverity;
  /** Issues belonging to this category */
  issues: AccessibilityIssue[];
  /** Currently selected issue ID */
  selectedIssueId: string | null;
  /** Callback when an issue is selected */
  onSelectIssue: (issueId: string) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get display configuration for a severity level
 */
function getSeverityConfig(severity: AccessibilityIssueSeverity): {
  label: string;
  pluralLabel: string;
  badgeColorClass: string;
  iconColorClass: string;
} {
  switch (severity) {
    case 'error':
      return {
        label: 'Error',
        pluralLabel: 'Errors',
        badgeColorClass: 'bg-ss-error text-ss-text-inverse',
        iconColorClass: 'text-ss-error',
      };
    case 'warning':
      return {
        label: 'Warning',
        pluralLabel: 'Warnings',
        badgeColorClass: 'bg-ss-warning text-ss-text-inverse',
        iconColorClass: 'text-ss-warning',
      };
    case 'tip':
      return {
        label: 'Tip',
        pluralLabel: 'Tips',
        badgeColorClass: 'bg-ss-info text-ss-text-inverse',
        iconColorClass: 'text-ss-info',
      };
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * AccessibilityCategorySection - A collapsible section for a severity category.
 *
 * Displays:
 * - Section header with severity name and issue count badge
 * - List of AccessibilityIssueItem components when expanded
 */
export const AccessibilityCategorySection = memo(function AccessibilityCategorySection({
  severity,
  issues,
  selectedIssueId,
  onSelectIssue,
}: AccessibilityCategorySectionProps) {
  // Get severity configuration
  const config = useMemo(() => getSeverityConfig(severity), [severity]);

  // Don't render section if no issues
  if (issues.length === 0) {
    return null;
  }

  // Determine label (singular vs plural)
  const countLabel = issues.length === 1 ? config.label : config.pluralLabel;

  return (
    <AccordionItem value={severity}>
      <AccordionTrigger className="py-2 px-3">
        <div className="flex items-center gap-2">
          {/* Section title */}
          <span className="font-medium text-ss-text">{countLabel}</span>

          {/* Issue count badge */}
          <span
            className={[
              'inline-flex items-center justify-center',
              'min-w-[20px] h-5 px-1.5',
              'text-caption font-medium',
              'rounded-full',
              config.badgeColorClass,
            ].join(' ')}
          >
            {issues.length}
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent>
        {/* Issue list */}
        <div
          role="list"
          aria-label={`${countLabel} list`}
          className="border border-ss-border rounded-ss-sm overflow-hidden"
        >
          {issues.map((issue) => (
            <AccessibilityIssueItem
              key={issue.id}
              issue={issue}
              isSelected={selectedIssueId === issue.id}
              onSelect={onSelectIssue}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
});
