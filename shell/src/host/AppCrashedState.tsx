/**
 * AppCrashedState - Error display component
 *
 * Displays when an app crashes with error details and retry option.
 *
 */

import { isDev } from '@mog/env';

export interface AppCrashedStateProps {
  /** ID of the crashed app */
  appId: string;

  /** The error that caused the crash */
  error?: Error;

  /** Retry handler (resets error boundary) */
  onRetry?: () => void;
}

/**
 * AppCrashedState - Displays error UI when an app crashes
 *
 * Provides:
 * - Clear error messaging
 * - Error details (message and stack in dev mode)
 * - Retry button to attempt recovery
 */
export function AppCrashedState({ appId, error, onRetry }: AppCrashedStateProps) {
  return (
    <div className="app-crashed">
      <div className="app-crashed__content">
        <h2>App crashed</h2>
        <p>
          The <strong>{appId}</strong> app encountered an error and had to stop.
        </p>

        {error && (
          <div className="app-crashed__error">
            <h3>Error Details</h3>
            <pre className="app-crashed__message">{error.message}</pre>

            {isDev() && error.stack && (
              <details className="app-crashed__stack">
                <summary>Stack trace</summary>
                <pre>{error.stack}</pre>
              </details>
            )}
          </div>
        )}

        {onRetry && (
          <button className="app-crashed__retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
