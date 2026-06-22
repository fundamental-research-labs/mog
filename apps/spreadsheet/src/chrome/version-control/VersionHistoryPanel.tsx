import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCommit, History, RefreshCw, X } from 'lucide-react';
import type {
  Paged,
  VersionAnnotationText,
  VersionCapability,
  VersionDiagnostic,
  VersionError,
  VersionHead,
  VersionResult,
  VersionSurfaceStatus,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { useWorkbook } from '../../internal-api';

const COMMIT_PAGE_SIZE = 20;

const CAPABILITY_ROWS: readonly VersionCapability[] = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
];

const CAPABILITY_LABELS: Record<VersionCapability, string> = {
  'version:read': 'Read',
  'version:diff': 'Diff',
  'version:commit': 'Commit',
  'version:branch': 'Branch',
  'version:checkout': 'Checkout',
  'version:reviewRead': 'Review read',
  'version:reviewWrite': 'Review write',
  'version:proposal': 'Proposal',
  'version:mergePreview': 'Merge preview',
  'version:mergeApply': 'Merge apply',
  'version:revert': 'Revert',
  'version:provenance': 'Provenance',
};

export interface VersionHistoryPanelProps {
  readonly onClose: () => void;
}

export interface VersionHistoryPanelContentProps {
  readonly workbook: VersionHistoryWorkbook;
  readonly onClose: () => void;
}

export type VersionHistoryWorkbook = {
  readonly version: Pick<
    WorkbookVersion,
    'getSurfaceStatus' | 'getStatus' | 'getHead' | 'listCommits'
  >;
};

type VersionHistoryLoadState =
  | { readonly status: 'loading'; readonly previous?: VersionHistoryData }
  | { readonly status: 'ready'; readonly data: VersionHistoryData }
  | { readonly status: 'error'; readonly diagnostics: readonly VersionPanelDiagnostic[] };

type VersionHistoryData = {
  readonly surface?: VersionSurfaceStatus;
  readonly rollout?: WorkbookVersionStatus;
  readonly head?: VersionHead;
  readonly commits: readonly WorkbookCommitSummary[];
  readonly diagnostics: readonly VersionPanelDiagnostic[];
};

type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

export function VersionHistoryPanel({ onClose }: VersionHistoryPanelProps): React.JSX.Element {
  const workbook = useWorkbook();
  return <VersionHistoryPanelContent workbook={workbook} onClose={onClose} />;
}

export function VersionHistoryPanelContent({
  workbook,
  onClose,
}: VersionHistoryPanelContentProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<VersionHistoryLoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setLoadState((current) => ({
      status: 'loading',
      previous:
        current.status === 'ready'
          ? current.data
          : current.status === 'loading'
            ? current.previous
            : undefined,
    }));

    const diagnostics: VersionPanelDiagnostic[] = [];
    const [surface, rollout, head, commits] = await Promise.all([
      readValue('VERSION_UI_SURFACE_STATUS_FAILED', () => workbook.version.getSurfaceStatus()),
      readValue('VERSION_UI_STATUS_FAILED', () => workbook.version.getStatus()),
      readVersionResult('VERSION_UI_HEAD_FAILED', () => workbook.version.getHead()),
      readVersionResult('VERSION_UI_COMMITS_FAILED', () =>
        workbook.version.listCommits({ pageSize: COMMIT_PAGE_SIZE, includeDiagnostics: true }),
      ),
    ]);

    if (!surface.ok) diagnostics.push(surface.diagnostic);
    if (!rollout.ok) diagnostics.push(rollout.diagnostic);
    if (!head.ok) diagnostics.push(head.diagnostic);
    if (!commits.ok) diagnostics.push(commits.diagnostic);

    const data: VersionHistoryData = {
      ...(surface.ok ? { surface: surface.value } : {}),
      ...(rollout.ok ? { rollout: rollout.value } : {}),
      ...(head.ok ? { head: head.value } : {}),
      commits: commits.ok ? commits.value.items : [],
      diagnostics,
    };

    if (!surface.ok && !rollout.ok && !head.ok && !commits.ok) {
      setLoadState({ status: 'error', diagnostics });
      return;
    }
    setLoadState({ status: 'ready', data });
  }, [workbook]);

  useEffect(() => {
    void load();
  }, [load]);

  const data =
    loadState.status === 'ready'
      ? loadState.data
      : loadState.status === 'loading'
        ? loadState.previous
        : undefined;
  const diagnostics =
    loadState.status === 'error' ? loadState.diagnostics : (data?.diagnostics ?? []);

  return (
    <aside
      data-testid="panel-version-history"
      role="complementary"
      aria-label="Version control"
      className="flex flex-col w-[320px] max-w-[calc(100vw-24px)] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <History
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
            className="text-ss-primary shrink-0"
          />
          <h2 className="text-subtitle font-semibold text-ss-text m-0 truncate">Version History</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            data-testid="panel-version-history-refresh"
            className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors disabled:opacity-50"
            aria-label="Refresh version history"
            title="Refresh"
            disabled={loadState.status === 'loading'}
          >
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="panel-version-history-close"
            className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
            aria-label="Close version history"
            title="Close"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadState.status === 'loading' && !data ? (
          <div
            className="px-4 py-5 text-body-sm text-ss-text-secondary"
            data-testid="version-history-loading"
          >
            Loading version history
          </div>
        ) : null}

        {loadState.status === 'error' ? (
          <DiagnosticsBlock diagnostics={diagnostics} emptyMessage="Version history unavailable" />
        ) : null}

        {data ? (
          <div className="flex flex-col gap-4 p-4">
            <VersionStatusSummary data={data} />
            <CapabilitySummary surface={data.surface} />
            <ProposalSurfaceStatus surface={data.surface} />
            <CommitList commits={data.commits} />
            {diagnostics.length > 0 ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function ProposalSurfaceStatus({
  surface,
}: {
  readonly surface?: VersionSurfaceStatus;
}): React.JSX.Element | null {
  const proposalState = surface?.capabilities['version:proposal'];
  if (!proposalState || proposalState.enabled) return null;

  return (
    <section
      className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
      aria-label="Proposal status"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-sm font-medium text-ss-text">Proposal review</span>
        <span className="text-[11px] leading-none uppercase text-ss-text-tertiary">
          Unavailable
        </span>
      </div>
      <div className="mt-1 text-body-sm text-ss-text-secondary">{proposalState.reason}</div>
    </section>
  );
}

function VersionStatusSummary({ data }: { readonly data: VersionHistoryData }): React.JSX.Element {
  const headId = data.head?.id ?? data.surface?.current.headCommitId;
  const branchName = data.surface?.current.branchName ?? data.head?.refName;
  const storageLabel = data.surface
    ? `${data.surface.storage.backend}${data.surface.storage.ready ? ' ready' : ' unavailable'}`
    : 'Unknown';
  const dirtyLabel = data.surface?.dirty.hasUncommittedLocalChanges
    ? 'Uncommitted changes'
    : 'Clean';

  return (
    <section className="flex flex-col gap-2" aria-label="Version status">
      <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-body-sm">
        <span className="text-ss-text-secondary">Stage</span>
        <span className="text-ss-text font-medium">
          {data.surface?.stage ?? data.rollout?.rolloutStage ?? 'Unknown'}
        </span>
        <span className="text-ss-text-secondary">Storage</span>
        <span className="text-ss-text">{storageLabel}</span>
        <span className="text-ss-text-secondary">Branch</span>
        <span className="text-ss-text truncate">{branchName ?? 'Detached or unavailable'}</span>
        <span className="text-ss-text-secondary">Head</span>
        <span className="font-mono text-xs text-ss-text truncate">
          {headId ? shortCommitId(headId) : 'Unavailable'}
        </span>
        <span className="text-ss-text-secondary">Workspace</span>
        <span className="text-ss-text">{dirtyLabel}</span>
      </div>
    </section>
  );
}

function CapabilitySummary({
  surface,
}: {
  readonly surface?: VersionSurfaceStatus;
}): React.JSX.Element {
  const rows = useMemo(
    () =>
      CAPABILITY_ROWS.map((capability) => ({
        capability,
        state: surface?.capabilities[capability],
      })),
    [surface],
  );

  return (
    <section className="flex flex-wrap gap-1.5" aria-label="Version capabilities">
      {rows.map(({ capability, state }) => {
        const enabled = state?.enabled === true;
        return (
          <span
            key={capability}
            className={`px-2 py-1 rounded-sm text-[11px] leading-none border ${
              enabled
                ? 'border-ss-success/40 text-ss-success bg-ss-success/10'
                : 'border-ss-border text-ss-text-secondary bg-ss-surface-secondary'
            }`}
            title={
              enabled
                ? `${CAPABILITY_LABELS[capability]} enabled`
                : (state?.reason ?? 'Unavailable')
            }
          >
            {CAPABILITY_LABELS[capability]}
          </span>
        );
      })}
    </section>
  );
}

function CommitList({
  commits,
}: {
  readonly commits: readonly WorkbookCommitSummary[];
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2" aria-label="Recent commits">
      <div className="flex items-center gap-2 text-body-sm font-semibold text-ss-text">
        <GitCommit size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>Recent Commits</span>
      </div>
      {commits.length === 0 ? (
        <div className="text-body-sm text-ss-text-secondary py-2">No commits available</div>
      ) : (
        <ol className="flex flex-col gap-2 m-0 p-0 list-none">
          {commits.map((commit) => (
            <li key={commit.id} className="border border-ss-border rounded-sm p-2 bg-ss-surface">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-body-sm font-medium text-ss-text truncate">
                    {annotationText(commit.annotation?.title) ??
                      annotationText(commit.annotation?.message) ??
                      shortCommitId(commit.id)}
                  </div>
                  <div className="font-mono text-[11px] text-ss-text-secondary truncate">
                    {shortCommitId(commit.id)}
                  </div>
                </div>
                <time
                  className="text-[11px] text-ss-text-secondary shrink-0"
                  dateTime={commit.createdAt}
                >
                  {formatCommitTime(commit.createdAt)}
                </time>
              </div>
              <div className="mt-1 text-[11px] text-ss-text-secondary truncate">
                {commit.author.displayName ?? commit.author.actorKind ?? 'Unknown author'}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DiagnosticsBlock({
  diagnostics,
  emptyMessage,
}: {
  readonly diagnostics: readonly VersionPanelDiagnostic[];
  readonly emptyMessage?: string;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 p-4" aria-label="Version diagnostics">
      {emptyMessage ? (
        <div className="text-body-sm font-medium text-ss-text">{emptyMessage}</div>
      ) : null}
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${index}`}
          className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
        >
          <div className="text-[11px] uppercase text-ss-text-tertiary">{diagnostic.severity}</div>
          <div className="text-body-sm text-ss-text">{diagnostic.message}</div>
        </div>
      ))}
    </section>
  );
}

async function readValue<T>(
  code: string,
  read: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

async function readVersionResult<T>(
  code: string,
  read: () => Promise<VersionResult<T>>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    const result = await read();
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, diagnostic: diagnosticFromError(code, result.error) };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

function diagnosticFromError(code: string, error: VersionError): VersionPanelDiagnostic {
  if (error.code === 'target_unavailable') {
    return {
      code: error.diagnostics[0]?.code ?? code,
      severity: error.diagnostics[0]?.severity ?? 'warning',
      message: error.diagnostics[0]?.message ?? error.target,
    };
  }
  if (error.code === 'version_capability_unavailable') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'invalid_state') {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'not_found') {
    return { code, severity: 'warning', message: error.reason };
  }
  return { code, severity: 'warning', message: error.code };
}

function annotationText(value: VersionAnnotationText | undefined): string | undefined {
  if (!value) return undefined;
  return value.kind === 'text' ? value.value : 'Redacted';
}

function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

function formatCommitTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
