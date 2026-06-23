import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

type VersionActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly label: string }
  | { readonly status: 'success'; readonly message: string }
  | { readonly status: 'error'; readonly diagnostic: VersionPanelDiagnostic };

export function ActionStatus({
  actionState,
}: {
  readonly actionState: VersionActionState;
}): React.JSX.Element | null {
  if (actionState.status === 'idle') return null;
  if (actionState.status === 'error') {
    return (
      <div
        role="alert"
        className="rounded-sm border border-ss-danger/40 bg-ss-danger/10 px-3 py-2 text-body-sm text-ss-text"
      >
        {actionState.diagnostic.message}
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="rounded-sm border border-ss-border bg-ss-surface-secondary px-3 py-2 text-body-sm text-ss-text-secondary"
    >
      {actionState.status === 'running' ? actionState.label : actionState.message}
    </div>
  );
}
