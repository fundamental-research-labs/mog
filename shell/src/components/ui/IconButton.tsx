/**
 * IconButton Component
 *
 * Button that displays only an icon, used for compact action buttons
 * in tables, toolbars, and other space-constrained contexts.
 *
 * @example
 * ```tsx
 * import { IconButton } from '../ui';
 *
 * // In a table row
 * <IconButton icon="edit" onClick={handleEdit} title="Edit item" />
 * <IconButton icon="delete" onClick={handleDelete} title="Delete item" variant="danger" />
 *
 * // Disabled state
 * <IconButton icon="arrow-up" onClick={handleMoveUp} disabled={isFirst} title="Move up" />
 * ```
 */

import type { MouseEvent } from 'react';
import { Icon, type IconName } from './Icon';

// =============================================================================
// Types
// =============================================================================

export interface IconButtonProps {
  /** Icon to display */
  icon: IconName;
  /** Click handler */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible title (shown on hover and used for aria-label) */
  title: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Visual variant */
  variant?: 'default' | 'danger';
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
  /** Stop click event propagation (useful in table rows) */
  stopPropagation?: boolean;
  /** Stable test selector (rendered as `data-testid`). */
  testId?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * IconButton - Compact button with icon only.
 *
 * Always requires a `title` prop for accessibility.
 * Use `stopPropagation` when inside clickable containers (like table rows).
 */
export function IconButton({
  icon,
  onClick,
  title,
  disabled = false,
  variant = 'default',
  size = 'md',
  className = '',
  stopPropagation = true,
  testId,
}: IconButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
    if (!disabled) {
      onClick(e);
    }
  };

  // Size classes
  const sizeClasses = {
    sm: 'p-1',
    md: 'p-1.5',
  };

  // Variant classes
  const variantClasses = {
    default: 'text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover',
    danger: 'text-ss-text-secondary hover:text-ss-error hover:bg-ss-error-bg',
  };

  const baseClasses =
    'rounded transition-colors duration-ss-fast cursor-pointer border-none bg-transparent';
  const disabledClasses = disabled
    ? 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-ss-text-secondary'
    : '';

  return (
    <button
      type="button"
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabledClasses} ${className}`}
      onClick={handleClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      data-testid={testId}
    >
      <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  );
}
