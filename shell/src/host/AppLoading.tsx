/**
 * AppLoading - Loading state component
 *
 * Displays while an app is being lazily loaded.
 *
 */

export interface AppLoadingProps {
  /** Optional app ID to display */
  appId?: string;
}

/**
 * AppLoading - Loading state for lazy-loaded apps
 *
 * Displays a loading indicator while the app code is being fetched.
 * Used as Suspense fallback.
 */
export function AppLoading({ appId }: AppLoadingProps) {
  return (
    <div className="app-loading">
      <div className="app-loading__spinner" />
      <p className="app-loading__message">{appId ? `Loading ${appId}...` : 'Loading app...'}</p>
    </div>
  );
}
