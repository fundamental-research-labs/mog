/**
 * SidePanel — generic right-edge panel host.
 *
 * The chrome-symmetry contract requires:
 * - Panel root: `data-testid="panel-side"` (assertable visibility)
 * - Visible close affordance: `data-testid="panel-side-close"`
 * - Reopen affordance: View ribbon `[data-action="open-panel-side"]`
 *
 * Why a generic side panel: the existing panels (chart editor, pivot
 * field, accessibility checker, extension) each "own" their own side-
 * panel slot and self-manage open/close through their own machines.
 * That's correct for those domain panels — the close affordance for the
 * chart editor lives on the chart editor's chrome, not here. But the
 * generic side-panel symmetry contract still needs a target: when the
 * user clicks "Open side panel" they should always land somewhere.
 *
 * Behavior: the side panel acts as the "default workspace pane" — it
 * shows a small index of available side panels (chart editor / pivot
 * fields / accessibility / comments / extensions). Each row opens the
 * underlying panel via dispatch. Closing this host stows the index but
 * does NOT close any other panel that may already be open.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormulaReferenceDiagnostic } from '@mog-sdk/contracts/api';

import { useUIStore, useUIStoreApi } from '../../infra/context';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useSelectionActions } from '../../hooks/selection/use-selection-actions';
import { useWorkbook } from '../../internal-api';

function SidePanelImpl() {
  const setSidePanelVisible = useUIStore((s) => s.setSidePanelVisible);
  const uiStore = useUIStoreApi();
  const deps = useActionDependencies();
  const sidePanelContent = useUIStore((s) => s.sidePanelContent);

  const setCommentsPanelVisible = useUIStore((s) => s.setCommentsPanelVisible);

  const handleClose = useCallback(() => {
    setSidePanelVisible(false);
  }, [setSidePanelVisible]);

  const handleOpenAccessibility = useCallback(() => {
    // The accessibility checker manages its own visibility via UIStore.
    uiStore.getState().openAccessibilityPanel?.();
  }, [uiStore]);

  const handleOpenComments = useCallback(() => {
    setCommentsPanelVisible(true);
  }, [setCommentsPanelVisible]);

  const handleOpenExtensions = useCallback(() => {
    dispatch('TOGGLE_EXTENSION_PANEL', deps);
  }, [deps]);

  if (sidePanelContent === 'formula-references') {
    return <FormulaReferenceDiagnosticsPanel onClose={handleClose} />;
  }

  return (
    <aside
      data-testid="panel-side"
      role="complementary"
      aria-label="Side panel"
      className="flex flex-col w-[240px] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <h2 className="text-subtitle font-semibold text-ss-text m-0">Panels</h2>
        <button
          type="button"
          onClick={handleClose}
          data-testid="panel-side-close"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          aria-label="Close side panel"
          title="Close (Esc)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={handleOpenComments}
          className="w-full text-left px-3 py-2 rounded text-body-sm text-ss-text hover:bg-ss-surface-hover"
        >
          Comments
        </button>
        <button
          type="button"
          onClick={handleOpenAccessibility}
          className="w-full text-left px-3 py-2 rounded text-body-sm text-ss-text hover:bg-ss-surface-hover"
        >
          Accessibility
        </button>
        <button
          type="button"
          onClick={handleOpenExtensions}
          className="w-full text-left px-3 py-2 rounded text-body-sm text-ss-text hover:bg-ss-surface-hover"
        >
          Extensions
        </button>
      </div>
    </aside>
  );
}

export const SidePanel = memo(SidePanelImpl);

function FormulaReferenceDiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const workbook = useWorkbook();
  const selectionActions = useSelectionActions();
  const setFormulaBarVisible = useUIStore((s) => s.setFormulaBarVisible);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [rows, setRows] = useState<readonly FormulaReferenceDiagnostic[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const load = useCallback(
    async (cursor?: string) => {
      setStatus('loading');
      try {
        const page = await workbook.diagnostics.getFormulaReferences({
          includeWarnings: true,
          limit: 1000,
          cursor,
        });
        setRows((current) => (cursor ? [...current, ...page.diagnostics] : page.diagnostics));
        setNextCursor(page.nextCursor);
        setSelectedId((current) => current ?? page.diagnostics[0]?.id);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [workbook],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(
    () => rows.filter((row) => filter === 'all' || row.severity === filter),
    [filter, rows],
  );

  const selected = visibleRows.find((row) => row.id === selectedId);

  const handleCopyFormula = useCallback(async () => {
    if (!selected?.formula) return;
    if (typeof navigator !== 'undefined') {
      await navigator.clipboard?.writeText(selected.formula);
    }
  }, [selected]);

  const jumpToSelected = useCallback(() => {
    if (
      selected?.sourceKind !== 'cell-formula' ||
      selected.location.row == null ||
      selected.location.col == null
    ) {
      return false;
    }
    const { row, col } = selected.location;
    selectionActions.setSelection([{ startRow: row, startCol: col, endRow: row, endCol: col }], {
      row,
      col,
    });
    return true;
  }, [selected, selectionActions]);

  const handleJump = useCallback(() => {
    jumpToSelected();
  }, [jumpToSelected]);

  const handleEditFormula = useCallback(() => {
    if (!jumpToSelected()) return;
    setFormulaBarVisible(true);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-testid="formula-bar"] input, [data-testid="formula-bar"] textarea',
      );
      input?.focus();
    });
  }, [jumpToSelected, setFormulaBarVisible]);

  return (
    <aside
      data-testid="formula-reference-diagnostics-panel"
      role="complementary"
      aria-label="Formula reference diagnostics"
      className="flex flex-col w-[420px] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <h2 className="text-subtitle font-semibold text-ss-text m-0">Formula References</h2>
        <button
          type="button"
          onClick={onClose}
          data-testid="formula-reference-diagnostics-close"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          aria-label="Close formula references"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-ss-border">
        {(['all', 'error', 'warning'] as const).map((item) => (
          <button
            key={item}
            type="button"
            data-testid={`formula-reference-filter-${item}`}
            onClick={() => setFilter(item)}
            className={`px-2 py-1 text-caption rounded border ${
              filter === item
                ? 'bg-ss-accent text-white border-ss-accent'
                : 'bg-ss-surface text-ss-text border-ss-border hover:bg-ss-surface-hover'
            }`}
          >
            {item === 'all' ? 'All' : item === 'error' ? 'Errors' : 'Warnings'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          data-testid="formula-reference-refresh"
          className="ml-auto px-2 py-1 text-caption rounded border border-ss-border hover:bg-ss-surface-hover"
        >
          Refresh
        </button>
      </div>

      {status === 'loading' && rows.length === 0 ? (
        <div className="p-4 text-body-sm text-ss-text-secondary">Loading</div>
      ) : status === 'error' ? (
        <div className="p-4 text-body-sm text-ss-text-secondary">
          <div>Unable to load formula references</div>
          <button type="button" className="mt-2 underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-4 text-body-sm text-ss-text-secondary">No broken formula references</div>
      ) : (
        <>
          <div className="flex-1 overflow-auto" data-testid="formula-reference-rows">
            {visibleRows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid="formula-reference-row"
                onClick={() => setSelectedId(row.id)}
                onDoubleClick={handleEditFormula}
                className={`grid w-full grid-cols-[76px_90px_76px_1fr] gap-2 px-3 py-2 text-left border-b border-ss-border text-caption ${
                  selectedId === row.id ? 'bg-ss-selection/20' : 'hover:bg-ss-surface-hover'
                }`}
              >
                <span className="truncate">{row.location.address ?? row.location.name ?? '-'}</span>
                <span className="truncate">
                  {row.type === 'reference-edge' ? row.kind : row.kind}
                </span>
                <span className="truncate">{row.severity}</span>
                <span className="truncate">
                  {row.type === 'reference-edge' ? row.edge.text : (row.formula ?? '')}
                </span>
              </button>
            ))}
          </div>
          <div className="shrink-0 border-t border-ss-border p-3 space-y-2">
            <div className="text-caption text-ss-text-secondary">
              Showing {visibleRows.length}
              {nextCursor ? ` of at least ${visibleRows.length}+` : ''}
            </div>
            {selected ? <FormulaPreview row={selected} /> : null}
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="formula-reference-copy"
                disabled={!selected?.formula}
                onClick={handleCopyFormula}
                className="px-2 py-1 text-caption rounded border border-ss-border disabled:opacity-50"
              >
                Copy Formula
              </button>
              <button
                type="button"
                data-testid="formula-reference-jump"
                disabled={selected?.sourceKind !== 'cell-formula'}
                onClick={handleJump}
                className="px-2 py-1 text-caption rounded border border-ss-border disabled:opacity-50"
                title={
                  selected?.sourceKind === 'named-range-formula'
                    ? 'Open Name Manager unavailable'
                    : undefined
                }
              >
                Jump
              </button>
              <button
                type="button"
                data-testid="formula-reference-edit"
                disabled={selected?.sourceKind !== 'cell-formula'}
                onClick={handleEditFormula}
                className="px-2 py-1 text-caption rounded border border-ss-border disabled:opacity-50"
                title={
                  selected?.sourceKind === 'named-range-formula'
                    ? 'Open Name Manager unavailable'
                    : undefined
                }
              >
                Edit Formula
              </button>
              {nextCursor ? (
                <button
                  type="button"
                  data-testid="formula-reference-load-more"
                  onClick={() => void load(nextCursor)}
                  className="ml-auto px-2 py-1 text-caption rounded border border-ss-border"
                >
                  More
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function FormulaPreview({ row }: { row: FormulaReferenceDiagnostic }) {
  const formula = row.formula ?? '';
  if (row.type !== 'reference-edge' || !formula) {
    return <div className="text-caption text-ss-text-secondary truncate">{formula}</div>;
  }
  const before = formula.slice(0, row.edge.spanStart);
  const token = formula.slice(row.edge.spanStart, row.edge.spanEnd);
  const after = formula.slice(row.edge.spanEnd);
  return (
    <div className="text-caption font-mono whitespace-nowrap overflow-hidden text-ellipsis">
      <span>{before}</span>
      <mark data-testid="formula-reference-token-highlight">{token}</mark>
      <span>{after}</span>
      {row.edge.refIndex != null && row.edge.refIndex > 0 ? (
        <span className="ml-2 text-ss-text-secondary">
          ({ordinal(row.edge.refIndex + 1)} occurrence)
        </span>
      ) : null}
    </div>
  );
}

function ordinal(value: number): string {
  const suffix = value === 2 ? '2nd' : value === 3 ? '3rd' : `${value}th`;
  return suffix;
}
