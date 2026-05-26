/**
 * EmptyState Component
 *
 * Consistent empty state display for dialogs, lists, and panels.
 * Uses proper icons instead of emoji for professional appearance.
 *
 * @example
 * ```tsx
 * import { EmptyState } from '../ui';
 *
 * // Basic empty state
 * <EmptyState
 *   title="No items found"
 *   description="Try adjusting your search or filter criteria"
 * />
 *
 * // With icon and action
 * <EmptyState
 *   icon="document-list"
 *   title="No rules configured"
 *   description="Create a new rule to get started"
 *   action={{ label: "New Rule", onClick: handleNewRule }}
 * />
 * ```
 */

import { Button } from './Button';
import { Icon, type IconName } from './Icon';

// =============================================================================
// Types
// =============================================================================

export interface EmptyStateProps {
  /** Title text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Optional icon to display above the title */
  icon?: IconName;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * EmptyState - Displays a placeholder when content is empty.
 *
 * Design principles:
 * - Uses proper icons (not emoji)
 * - Muted colors that don't compete with primary content
 * - Optional action to guide users on next steps
 */
export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`py-10 flex flex-col items-center text-center ${className}`}>
      {icon && (
        <div className="mb-3 text-ss-text-tertiary">
          <Icon name={icon} size="lg" />
        </div>
      )}
      <div className="text-body text-ss-text-secondary">{title}</div>
      {description && <div className="mt-2 text-body-sm text-ss-text-tertiary">{description}</div>}
      {action && (
        <Button variant="secondary" onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  );
}
