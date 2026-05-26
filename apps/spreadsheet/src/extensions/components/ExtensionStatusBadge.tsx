/**
 * Extension Status Badge
 *
 * Displays the connection status of an extension with visual indicators.
 * Shows loading spinner, error states, and secure connection badge.
 *
 * @module extensions/components/ExtensionStatusBadge
 */

import { type ReactNode } from 'react';

import type { ExtensionLifecycleState } from '../types';

// =============================================================================
// Types
// =============================================================================

interface ExtensionStatusBadgeProps {
  /** Current lifecycle state of the extension */
  state: ExtensionLifecycleState;
  /** Error message if state is 'error' */
  error?: string | null;
  /** Show the secure badge (cross-origin isolation active) */
  showSecureBadge?: boolean;
  /** Callback when retry button is clicked */
  onRetry?: () => void;
  /** Size variant */
  size?: 'small' | 'medium';
}

// =============================================================================
// Status Config
// =============================================================================

interface StatusConfig {
  label: string;
  badgeClass: string;
  icon: ReactNode;
}

function getStatusConfig(state: ExtensionLifecycleState, size: 'small' | 'medium'): StatusConfig {
  const spinnerSizeClass = size === 'small' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const dotSizeClass = size === 'small' ? 'w-[5px] h-[5px]' : 'w-1.5 h-1.5';

  const spinner = (
    <span
      className={`${spinnerSizeClass} border-2 border-current border-t-transparent rounded-full animate-spin`}
      aria-hidden="true"
    />
  );

  const dot = (colorClass: string) => (
    <span className={`${dotSizeClass} rounded-full ${colorClass}`} aria-hidden="true" />
  );

  switch (state) {
    case 'idle':
      return {
        label: 'Idle',
        badgeClass: 'bg-ss-surface-tertiary text-ss-text-secondary',
        icon: dot('bg-ss-text-disabled'),
      };
    case 'loading':
      return {
        label: 'Loading',
        badgeClass: 'bg-ss-primary-light text-ss-primary',
        icon: spinner,
      };
    case 'handshaking':
      return {
        label: 'Connecting',
        badgeClass: 'bg-ss-warning-bg text-ss-warning-text',
        icon: spinner,
      };
    case 'ready':
      return {
        label: 'Connected',
        badgeClass: 'bg-ss-success-bg text-ss-success-text',
        icon: dot('bg-ss-success'),
      };
    case 'error':
      return {
        label: 'Error',
        badgeClass: 'bg-ss-error-bg text-ss-error-text',
        icon: dot('bg-ss-error'),
      };
    case 'disconnected':
      return {
        label: 'Disconnected',
        badgeClass: 'bg-ss-surface-secondary text-ss-text-disabled',
        icon: dot('bg-ss-text-disabled'),
      };
    default:
      return {
        label: 'Unknown',
        badgeClass: 'bg-ss-surface-tertiary text-ss-text-secondary',
        icon: dot('bg-ss-text-disabled'),
      };
  }
}

// =============================================================================
// Component
// =============================================================================

export function ExtensionStatusBadge({
  state,
  error,
  showSecureBadge = false,
  onRetry,
  size = 'medium',
}: ExtensionStatusBadgeProps) {
  const config = getStatusConfig(state, size);

  const sizeClasses =
    size === 'small' ? 'text-ribbon-compact px-1.5 py-px' : 'text-hint px-2 py-0.5';

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Status badge */}
      <span
        className={`inline-flex items-center gap-1 rounded-ss-xl font-medium leading-4 ${sizeClasses} ${config.badgeClass}`}
        role="status"
        aria-label={`Extension status: ${config.label}`}
      >
        {config.icon}
        {config.label}
      </span>

      {/* Error message and retry button */}
      {state === 'error' && error && (
        <>
          <span
            className="text-hint text-ss-error max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
            title={error}
          >
            {error}
          </span>
          {onRetry && (
            <button
              className="ml-1 px-1.5 py-0.5 border-none rounded bg-transparent text-ss-error text-hint cursor-pointer underline"
              onClick={onRetry}
              aria-label="Retry connection"
            >
              Retry
            </button>
          )}
        </>
      )}

      {/* Secure badge */}
      {showSecureBadge && state === 'ready' && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-ribbon-compact font-medium bg-ss-success-bg text-ss-success-text"
          title="Cross-origin isolation active"
        >
          <span className="text-ribbon-compact" aria-hidden="true">
            🔒
          </span>
          Secure
        </span>
      )}
    </div>
  );
}
