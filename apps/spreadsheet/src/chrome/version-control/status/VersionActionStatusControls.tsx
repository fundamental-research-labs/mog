import { GitCommit } from 'lucide-react';

import {
  DisabledReason,
  sanitizeVersionStatusText,
} from '../availability/version-action-availability';
import {
  sanitizeVersionPanelDiagnostic,
  VERSION_ACTION_UNAVAILABLE,
} from './version-action-status-model';
import type { VersionActionState } from './version-action-status-types';

export function ActionStatus({
  actionState,
}: {
  readonly actionState: VersionActionState;
}): React.JSX.Element | null {
  if (actionState.status === 'idle') return null;
  if (actionState.status === 'error') {
    const diagnostic = sanitizeVersionPanelDiagnostic(actionState.diagnostic);
    return (
      <div
        role="alert"
        className="rounded-sm border border-ss-danger/40 bg-ss-danger/10 px-3 py-2 text-body-sm text-ss-text"
      >
        {diagnostic.message}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={actionState.status === 'running'}
      className="rounded-sm border border-ss-border bg-ss-surface-secondary px-3 py-2 text-body-sm text-ss-text-secondary"
    >
      {actionState.status === 'running' ? actionState.label : actionState.message}
    </div>
  );
}

type VersionActionsProps = {
  readonly commitMessage: string;
  readonly actionState: VersionActionState;
  readonly commitEnabled: boolean;
  readonly commitDisabledReason?: string;
  readonly onCommitMessageChange: (value: string) => void;
  readonly onCommit: () => void;
};

type DisabledControlStatus = {
  readonly enabled: boolean;
  readonly reasonId: string;
  readonly reason: string | undefined;
};

type VersionActionControls = {
  readonly commit: DisabledControlStatus;
};

export function VersionActions(props: VersionActionsProps): React.JSX.Element {
  const controls = getVersionActionControls(props);

  return (
    <section className="flex flex-col gap-3" aria-label="Version actions">
      <CommitAction
        message={props.commitMessage}
        control={controls.commit}
        onMessageChange={props.onCommitMessageChange}
        onCommit={props.onCommit}
      />

      {props.actionState.status !== 'idle' ? (
        <div data-testid="version-history-action-result" data-status={props.actionState.status}>
          <ActionStatus actionState={props.actionState} />
        </div>
      ) : null}
    </section>
  );
}

function getVersionActionControls({
  commitEnabled,
  commitDisabledReason,
}: VersionActionsProps): VersionActionControls {
  const commitReason = sanitizeVersionStatusText(commitDisabledReason, VERSION_ACTION_UNAVAILABLE);

  return {
    commit: {
      enabled: commitEnabled,
      reasonId: 'version-commit-disabled-reason',
      reason: commitReason,
    },
  };
}

function CommitAction({
  message,
  control,
  onMessageChange,
  onCommit,
}: {
  readonly message: string;
  readonly control: DisabledControlStatus;
  readonly onMessageChange: (value: string) => void;
  readonly onCommit: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="version-commit-message" className="text-body-sm font-medium text-ss-text">
        Commit message
      </label>
      <textarea
        id="version-commit-message"
        data-testid="version-history-commit-message-input"
        value={message}
        onChange={(event) => onMessageChange(event.currentTarget.value)}
        rows={2}
        className="w-full resize-none rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm text-ss-text outline-none focus:border-ss-primary"
      />
      <button
        type="button"
        data-testid="version-history-commit-button"
        onClick={onCommit}
        disabled={!control.enabled}
        aria-describedby={!control.enabled && control.reason ? control.reasonId : undefined}
        title={!control.enabled ? control.reason : undefined}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-ss-border bg-ss-surface-secondary px-2.5 text-body-sm font-medium text-ss-text transition-colors hover:bg-ss-surface-hover disabled:opacity-50 disabled:hover:bg-ss-surface-secondary"
      >
        <GitCommit size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Commit</span>
      </button>
      <DisabledReason
        id={control.reasonId}
        reason={!control.enabled ? control.reason : undefined}
      />
    </div>
  );
}
