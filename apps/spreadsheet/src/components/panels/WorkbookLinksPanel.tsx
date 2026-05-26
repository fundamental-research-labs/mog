import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CopyWorkbookLinkSourceResult,
  WorkbookExternalLinkUsageView,
  WorkbookExternalPackageArtifactView,
  WorkbookLinkView,
} from '@mog-sdk/kernel';

import { useUIStore, useWorkbook } from '../../infra/context';

export function WorkbookLinksPanel(): React.JSX.Element {
  const wb = useWorkbook();
  const linksApi = wb.links as unknown as {
    list(): readonly WorkbookLinkView[];
    refresh(linkId: string): Promise<unknown>;
    refreshAll(): Promise<unknown>;
    getUsages(linkId: string): Promise<readonly WorkbookExternalLinkUsageView[]>;
    copySource(linkId: string): Promise<CopyWorkbookLinkSourceResult>;
    listPackageDiagnostics(): Promise<readonly WorkbookExternalPackageArtifactView[]>;
  };
  const panel = useUIStore((s) => s.workbookLinksPanel);
  const close = useUIStore((s) => s.closeWorkbookLinksPanel);
  const selectLink = useUIStore((s) => s.selectWorkbookLink);
  const setTab = useUIStore((s) => s.setWorkbookLinksPanelTab);
  const setFilter = useUIStore((s) => s.setWorkbookLinksPanelFilter);
  const [links, setLinks] = useState<readonly WorkbookLinkView[]>([]);
  const [usages, setUsages] = useState<readonly WorkbookExternalLinkUsageView[]>([]);
  const [diagnostics, setDiagnostics] = useState<readonly WorkbookExternalPackageArtifactView[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    const nextLinks = linksApi.list();
    setLinks(nextLinks);
    setDiagnostics(await linksApi.listPackageDiagnostics());
    const selected = panel.selectedLinkId ?? nextLinks[0]?.linkId ?? null;
    if (selected && selected !== panel.selectedLinkId) selectLink(selected);
    setUsages(selected ? await linksApi.getUsages(selected) : []);
  }, [linksApi, panel.selectedLinkId, selectLink]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => links.find((link) => link.linkId === panel.selectedLinkId) ?? links[0] ?? null,
    [links, panel.selectedLinkId],
  );

  const visibleLinks = useMemo(() => {
    const filter = panel.filter.trim().toLowerCase();
    if (!filter) return links;
    return links.filter((link) =>
      [link.displayName, link.sourceKind, link.targetDisplay, link.status.displayMessage]
        .join(' ')
        .toLowerCase()
        .includes(filter),
    );
  }, [links, panel.filter]);

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    await linksApi.refresh(selected.linkId);
    await load();
  }, [linksApi, load, selected]);

  const refreshAll = useCallback(async () => {
    await linksApi.refreshAll();
    await load();
  }, [linksApi, load]);

  const copySource = useCallback(async () => {
    if (!selected) return;
    const result: CopyWorkbookLinkSourceResult = await linksApi.copySource(selected.linkId);
    setMessage(result.type === 'copied' ? 'Source copied' : copyDeniedMessage(result.deniedReason));
  }, [linksApi, selected]);

  const locateUsage = useCallback((usage: WorkbookExternalLinkUsageView) => {
    setMessage(locateMessage(usage));
  }, []);

  return (
    <aside className="h-full w-[520px] max-w-[calc(100vw-32px)] bg-ss-surface border-l border-ss-border shadow-xl flex flex-col text-body">
      <header className="flex items-center justify-between px-3 py-2 border-b border-ss-border">
        <div className="font-medium text-ss-text-primary">Workbook Links</div>
        <button
          type="button"
          className="px-2 py-1 hover:bg-ss-surface-hover"
          onClick={close}
          aria-label="Close Workbook Links"
        >
          x
        </button>
      </header>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ss-border">
        <button
          type="button"
          className={tabClass(panel.tab === 'links')}
          onClick={() => setTab('links')}
        >
          Links
        </button>
        <button
          type="button"
          className={tabClass(panel.tab === 'diagnostics')}
          onClick={() => setTab('diagnostics')}
        >
          Diagnostics
        </button>
        <input
          className="ml-auto w-44 px-2 py-1 border border-ss-border bg-ss-surface text-caption"
          value={panel.filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter workbook links"
        />
      </div>
      {message ? (
        <div className="px-3 py-1 text-caption border-b border-ss-border">{message}</div>
      ) : null}
      {panel.tab === 'diagnostics' ? (
        <DiagnosticsTable diagnostics={diagnostics} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0 flex-1">
          <div className="border-r border-ss-border min-w-0 overflow-auto">
            <div className="flex gap-2 p-2 border-b border-ss-border">
              <button
                type="button"
                className="px-2 py-1 border border-ss-border"
                disabled={!selected?.canRefresh}
                onClick={refreshSelected}
              >
                Refresh
              </button>
              <button
                type="button"
                className="px-2 py-1 border border-ss-border"
                onClick={refreshAll}
              >
                Refresh All
              </button>
              <button
                type="button"
                className="px-2 py-1 border border-ss-border"
                disabled={!selected?.canCopySource}
                onClick={copySource}
              >
                Copy Source
              </button>
            </div>
            {visibleLinks.length === 0 ? (
              <div className="p-3 text-ss-text-secondary">No workbook links</div>
            ) : (
              visibleLinks.map((link) => (
                <button
                  key={link.linkId}
                  type="button"
                  className={`block w-full text-left px-3 py-2 border-b border-ss-border hover:bg-ss-surface-hover ${selected?.linkId === link.linkId ? 'bg-ss-surface-selected' : ''}`}
                  onClick={async () => {
                    selectLink(link.linkId);
                    setUsages(await linksApi.getUsages(link.linkId));
                  }}
                >
                  <div className="font-medium truncate">{link.displayName}</div>
                  <div className="text-caption text-ss-text-secondary truncate">
                    {link.targetDisplay}
                  </div>
                  <div className="text-caption">
                    {link.status.displayMessage} - {link.usageCount} usages
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="min-w-0 overflow-auto">
            <UsageTable usages={usages} onLocate={locateUsage} />
          </div>
        </div>
      )}
    </aside>
  );
}

function UsageTable({
  usages,
  onLocate,
}: {
  usages: readonly WorkbookExternalLinkUsageView[];
  onLocate: (usage: WorkbookExternalLinkUsageView) => void;
}) {
  if (usages.length === 0)
    return <div className="p-3 text-ss-text-secondary">No active usages</div>;
  return (
    <div>
      {usages.map((usage) => (
        <div key={usage.usageId} className="px-3 py-2 border-b border-ss-border">
          <div className="font-medium truncate">{usage.usageKind}</div>
          <div className="text-caption text-ss-text-secondary truncate">
            {usage.sheetName ?? usage.objectId ?? usage.address ?? ''}
          </div>
          <div className="text-caption truncate">{usage.expressionPreview ?? ''}</div>
          <button
            type="button"
            className="mt-1 px-2 py-1 border border-ss-border"
            onClick={() => onLocate(usage)}
          >
            Locate
          </button>
        </div>
      ))}
    </div>
  );
}

function DiagnosticsTable({
  diagnostics,
}: {
  diagnostics: readonly WorkbookExternalPackageArtifactView[];
}) {
  if (diagnostics.length === 0)
    return <div className="p-3 text-ss-text-secondary">No package diagnostics</div>;
  return (
    <div className="overflow-auto">
      {diagnostics.map((item) => (
        <div key={item.artifactId} className="px-3 py-2 border-b border-ss-border">
          <div className="font-medium truncate">{item.artifactKind}</div>
          <div className="text-caption text-ss-text-secondary truncate">{item.partName}</div>
          <div className="text-caption truncate">{item.diagnostic}</div>
          <div className="text-caption">{item.tombstoned ? 'Tombstoned' : 'Preserved'}</div>
        </div>
      ))}
    </div>
  );
}

function tabClass(active: boolean): string {
  return `px-2 py-1 border border-ss-border ${active ? 'bg-ss-surface-selected' : 'bg-ss-surface'}`;
}

function copyDeniedMessage(reason: string): string {
  if (reason === 'unsupportedLinkKind') return 'Copy source is unavailable for this link kind';
  if (reason === 'redacted') return 'Source is redacted for this principal';
  return 'Permission denied';
}

function locateMessage(usage: WorkbookExternalLinkUsageView): string {
  if (usage.locate.kind === 'cell') return `Located ${usage.locate.address}`;
  if (usage.locate.kind === 'range') return `Located ${usage.locate.range}`;
  if (usage.locate.kind === 'disabled') return `Locate disabled: ${usage.locate.reason}`;
  return 'Locate target is not available';
}
