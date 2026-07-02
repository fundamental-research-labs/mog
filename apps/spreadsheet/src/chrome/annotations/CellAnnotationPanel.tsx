import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import type { WorksheetCellAnnotationRecord } from '@mog-sdk/contracts/api';

import { useActiveCell, useActiveSheetId, useReadOnly, useWorkbook } from '../../internal-api';

interface CellAnnotationPanelProps {
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'saving' | 'error';

function disposeSubscription(subscription: unknown): void {
  if (typeof subscription === 'function') {
    subscription();
    return;
  }
  if (
    subscription &&
    typeof subscription === 'object' &&
    'dispose' in subscription &&
    typeof (subscription as { dispose?: unknown }).dispose === 'function'
  ) {
    (subscription as { dispose: () => void }).dispose();
  }
}

function statusLabel(record: WorksheetCellAnnotationRecord | null): string {
  if (!record) return 'No annotation';
  if (record.status === 'fresh') return 'Fresh';
  if (record.status === 'stale') return 'Stale';
  return 'Unchecked';
}

function CellAnnotationPanelImpl({ onClose }: CellAnnotationPanelProps): React.JSX.Element {
  const workbook = useWorkbook();
  const sheetId = useActiveSheetId();
  const worksheet = useMemo(() => workbook.getSheetById(sheetId), [workbook, sheetId]);
  const { row, col } = useActiveCell();
  const readOnly = useReadOnly();
  const address = toA1(row, col);

  const [record, setRecord] = useState<WorksheetCellAnnotationRecord | null>(null);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError(null);
    void (async () => {
      try {
        const next = await worksheet.annotations.cells.diagnostics.get(row, col, {
          includeStale: true,
          includeUnchecked: true,
        });
        if (cancelled) return;
        setRecord(next);
        setDraft(next?.text ?? '');
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setRecord(null);
        setDraft('');
        setError(err instanceof Error ? err.message : 'Could not load annotation.');
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [col, reloadToken, row, worksheet]);

  useEffect(() => {
    const subscriptions = [
      workbook.on('cellAnnotation:changed', (event: any) => {
        if (event.sheetId === sheetId && event.row === row && event.col === col) reload();
      }),
      workbook.on('cellAnnotations:cleared', (event: any) => {
        if (event.sheetId === sheetId) reload();
      }),
      workbook.on('cell:changed', (event: any) => {
        if (event.sheetId === sheetId && event.row === row && event.col === col) reload();
      }),
      workbook.on('cells:batch-changed', (event: any) => {
        if (
          event.sheetId === sheetId &&
          Array.isArray(event.changes) &&
          event.changes.some((change: any) => change.row === row && change.col === col)
        ) {
          reload();
        }
      }),
    ];
    return () => {
      for (const subscription of subscriptions) disposeSubscription(subscription);
    };
  }, [col, reload, row, sheetId, workbook]);

  const save = useCallback(async () => {
    if (readOnly) return;
    setState('saving');
    setError(null);
    try {
      if (draft.trim().length === 0) {
        await worksheet.annotations.cells.remove(row, col);
        setRecord(null);
        setDraft('');
      } else {
        const saved = await worksheet.annotations.cells.set(row, col, draft);
        setRecord(saved);
        setDraft(saved.text);
      }
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save annotation.');
      setState('error');
    }
  }, [col, draft, readOnly, row, worksheet]);

  const remove = useCallback(async () => {
    if (readOnly) return;
    setState('saving');
    setError(null);
    try {
      await worksheet.annotations.cells.remove(row, col);
      setRecord(null);
      setDraft('');
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove annotation.');
      setState('error');
    }
  }, [col, readOnly, row, worksheet]);

  const acceptStale = useCallback(async () => {
    if (readOnly || !record) return;
    setState('saving');
    setError(null);
    try {
      const accepted = await worksheet.annotations.cells.acceptStale(row, col);
      setRecord(accepted);
      setDraft(accepted.text);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh annotation.');
      setState('error');
    }
  }, [col, readOnly, record, row, worksheet]);

  const dirty = draft !== (record?.text ?? '');
  const busy = state === 'loading' || state === 'saving';

  return (
    <aside
      data-testid="panel-cell-annotation"
      role="complementary"
      aria-label="Cell annotation"
      className="flex flex-col w-[300px] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <div className="min-w-0">
          <h2 className="text-subtitle font-semibold text-ss-text m-0">Cell Annotation</h2>
          <div className="text-ribbon-compact text-ss-text-tertiary">{address}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="panel-cell-annotation-close"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          aria-label="Close cell annotation panel"
          title="Close"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-medium text-ss-text">Status</span>
          <span
            data-testid="cell-annotation-status"
            className="text-ribbon-compact px-2 py-0.5 rounded bg-ss-surface-secondary text-ss-text-secondary"
          >
            {state === 'loading' ? 'Loading' : statusLabel(record)}
          </span>
        </div>

        <label className="text-body-sm font-medium text-ss-text" htmlFor="cell-annotation-editor">
          Text
        </label>
        <textarea
          id="cell-annotation-editor"
          data-testid="cell-annotation-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={readOnly || busy}
          className="min-h-[180px] resize-y rounded border border-ss-border bg-ss-surface px-3 py-2 text-body-sm text-ss-text outline-none focus:ring-2 focus:ring-ss-primary focus:border-ss-primary disabled:bg-ss-surface-secondary disabled:text-ss-text-tertiary"
          spellCheck
        />

        {error ? (
          <div className="text-body-sm text-ss-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="border-t border-ss-border p-3 flex items-center justify-between gap-2 bg-ss-surface-secondary shrink-0">
        <button
          type="button"
          onClick={remove}
          disabled={readOnly || busy || (!record && draft.trim().length === 0)}
          className="h-8 px-2 inline-flex items-center gap-1 rounded text-body-sm text-ss-text-secondary hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="cell-annotation-remove"
          aria-label="Remove annotation"
          title="Remove annotation"
        >
          <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
          Remove
        </button>
        <div className="flex items-center gap-2">
          {record && record.status !== 'fresh' ? (
            <button
              type="button"
              onClick={acceptStale}
              disabled={readOnly || busy}
              className="h-8 px-2 inline-flex items-center gap-1 rounded text-body-sm text-ss-text-secondary hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="cell-annotation-accept-stale"
              aria-label="Refresh annotation"
              title="Refresh annotation"
            >
              <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
              Refresh
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={readOnly || busy || !dirty}
            className="h-8 px-3 inline-flex items-center gap-1 rounded bg-ss-primary text-ss-text-inverse text-body-sm font-medium hover:bg-ss-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="cell-annotation-save"
            aria-label="Save annotation"
            title="Save annotation"
          >
            <Check size={15} strokeWidth={1.75} aria-hidden="true" />
            Save
          </button>
        </div>
      </div>
    </aside>
  );
}

export const CellAnnotationPanel = memo(CellAnnotationPanelImpl);
