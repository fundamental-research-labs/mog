/**
 * StatusBadge Primitive
 *
 * Status indicator badge using semantic status tokens.
 * Uses Tailwind classes mapped to design tokens from globals.css.
 *
 * Replaces hardcoded status color configurations throughout the codebase
 * with a consistent, token-based approach.
 */

// =============================================================================
// Types
// =============================================================================

/** Status types matching semantic token categories */
export type BadgeStatus = 'success' | 'warning' | 'error' | 'info' | 'idle';

/** Connection-specific status types */
export type ConnectionStatusType =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'error'
  | 'refreshing'
  | 'stale';

export interface StatusBadgeProps {
  /** Status type - determines colors */
  status: BadgeStatus;
  /** Badge label text */
  label: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Show animated dot indicator */
  showDot?: boolean;
  /** Animate the dot (for loading/refreshing states) */
  animateDot?: boolean;
  /** Additional class names */
  className?: string;
}

export interface ConnectionBadgeProps {
  /** Connection status */
  status: ConnectionStatusType;
  /** Custom label (defaults to status-based label) */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional class names */
  className?: string;
}

// =============================================================================
// StatusBadge Component
// =============================================================================

/**
 * StatusBadge - Status indicator using semantic tokens.
 *
 * Uses the semantic status tokens:
 * - success: --color-success-bg, --color-success-text
 * - warning: --color-warning-bg, --color-warning-text
 * - error: --color-error-bg, --color-error-text
 * - info: --color-info-bg, --color-info-text
 * - idle: --color-state-idle-bg, --color-state-idle
 *
 * @example
 * ```tsx
 * // Basic usage
 * <StatusBadge status="success" label="Connected" />
 * <StatusBadge status="error" label="Failed" />
 *
 * // With animated dot
 * <StatusBadge status="info" label="Loading..." showDot animateDot />
 *
 * // Small size
 * <StatusBadge status="warning" label="Stale" size="sm" />
 * ```
 */
export function StatusBadge({
  status,
  label,
  size = 'md',
  showDot = true,
  animateDot = false,
  className = '',
}: StatusBadgeProps) {
  // Map status to token-based classes
  const statusStyles: Record<BadgeStatus, { bg: string; text: string; dot: string }> = {
    success: {
      bg: 'bg-ss-success-bg',
      text: 'text-ss-success-text',
      dot: 'bg-ss-success',
    },
    warning: {
      bg: 'bg-ss-warning-bg',
      text: 'text-ss-warning-text',
      dot: 'bg-ss-warning',
    },
    error: {
      bg: 'bg-ss-error-bg',
      text: 'text-ss-error-text',
      dot: 'bg-ss-error',
    },
    info: {
      bg: 'bg-ss-info-bg',
      text: 'text-info-text',
      dot: 'bg-ss-info',
    },
    idle: {
      bg: 'bg-state-idle-bg',
      text: 'text-state-idle',
      dot: 'bg-state-idle',
    },
  };

  // Size variants
  const sizeStyles = {
    sm: {
      container: 'px-1.5 py-0.5 text-ribbon-compact', // 10px
      dot: 'w-1.5 h-1.5',
    },
    md: {
      container: 'px-2 py-0.5 text-ribbon', // 11px
      dot: 'w-1.5 h-1.5',
    },
  };

  const { bg, text, dot } = statusStyles[status];
  const { container: containerSize, dot: dotSize } = sizeStyles[size];

  const containerClasses = [
    'inline-flex items-center gap-1 rounded-full font-medium',
    bg,
    text,
    containerSize,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const dotClasses = ['rounded-full', dot, dotSize, animateDot && 'animate-ss-pulse']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={containerClasses}>
      {showDot && <span className={dotClasses} aria-hidden="true" />}
      {label}
    </span>
  );
}

// =============================================================================
// ConnectionBadge Component
// =============================================================================

/**
 * ConnectionBadge - Specialized badge for connection status.
 *
 * Maps ConnectionStatus types to appropriate StatusBadge configurations
 * with sensible defaults for labels and animations.
 *
 * @example
 * ```tsx
 * // Automatically labeled
 * <ConnectionBadge status="connected" />
 * <ConnectionBadge status="refreshing" />
 *
 * // Custom label
 * <ConnectionBadge status="error" label="Connection failed" />
 * ```
 */
export function ConnectionBadge({
  status,
  label,
  size = 'md',
  className = '',
}: ConnectionBadgeProps) {
  // Map connection status to badge status and default label
  const statusConfig: Record<
    ConnectionStatusType,
    { badgeStatus: BadgeStatus; defaultLabel: string; animate: boolean }
  > = {
    idle: { badgeStatus: 'idle', defaultLabel: 'Idle', animate: false },
    connecting: { badgeStatus: 'info', defaultLabel: 'Connecting...', animate: true },
    connected: { badgeStatus: 'success', defaultLabel: 'Connected', animate: false },
    synced: { badgeStatus: 'info', defaultLabel: 'Synced', animate: false },
    refreshing: { badgeStatus: 'info', defaultLabel: 'Refreshing...', animate: true },
    stale: { badgeStatus: 'warning', defaultLabel: 'Stale', animate: false },
    error: { badgeStatus: 'error', defaultLabel: 'Error', animate: false },
  };

  const { badgeStatus, defaultLabel, animate } = statusConfig[status];

  return (
    <StatusBadge
      status={badgeStatus}
      label={label ?? defaultLabel}
      size={size}
      showDot
      animateDot={animate}
      className={className}
    />
  );
}
