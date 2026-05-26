/**
 * <MogSheet /> — React component for embedded Mog spreadsheet.
 *
 * @stability public-experimental
 * @remarks
 * This is the `@mog-sdk/embed/react` entrypoint. All symbols exported from
 * this path are classified `public-experimental` per public exposure tiers.
 *
 * Usage:
 *   import { MogSheet } from '@mog-sdk/embed/react';
 *   <MogSheet config={config} hostPolicy={hostPolicy} width={1200} height={600} />
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createEmbedRenderer, type EmbedRenderOrchestrator } from '../renderer/index';
import {
  createReactEmbedHost,
  type ReactEmbedHostResult,
} from '../host-adapters/react-same-page-host';
import type { SheetEventScrollChange, SheetEventZoomChange } from '@mog-sdk/sheet-view';
import type { EmbedStatus } from '../types';
import type {
  EmbedMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedHostPolicy,
} from '../config';

export type { EmbedStatus } from '../types';
export type {
  ScrollPosition,
  SheetEventScrollChange,
  SheetEventZoomChange,
} from '@mog-sdk/sheet-view';
export type {
  EmbedMode,
  MogEmbedSourceRef,
  MogEmbedChromeOptions,
  MogEmbedThemeOptions,
  MogEmbedSavePolicy,
  MogEmbedCollaborationMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedResolvedSource,
  MogEmbedHostPolicy,
  MogEmbedLifecycleState,
  MogEmbedEventMap,
  MogEmbedConfigValidationError,
} from '../config';
export { validateMogEmbedConfig, assertValidMogEmbedConfig } from '../config';

/** @stability public-experimental */
export interface MogSheetSelection {
  row: number;
  col: number;
}

/** @stability public-experimental */
export interface MogSheetChange {
  index: number;
  name: string;
  sheetId: string;
}

/** @stability public-experimental */
export interface MogSheetHandle {
  /** Current lifecycle status. */
  getStatus(): EmbedStatus;
  /** Switch sheets through the same path as the built-in sheet tabs. */
  setSheet(indexOrName: number | string): Promise<void>;
  /** Current dirty flag from the embedded document. */
  isDirty(): boolean;
  /** Mark the workbook clean after host-controlled persistence succeeds. */
  markClean(): void;
  /** Focus the embedded sheet view. */
  focus(): void;
  /** Request save through the host policy. */
  requestSave(): Promise<boolean>;
  /** Request export through the host policy in the given format. */
  requestExport(format: string): Promise<Blob | null>;
  /** Current effective state snapshot (null before ready). */
  getEffectiveState(): MogEmbedEffectiveState | null;
  /** Navigate to a cell range (e.g. "A1", "B2:D10"). */
  navigateToRange(range: string): void;
  /** Recalculate layout after external container resize. */
  resize(): void;
  /** Tear down renderer and workbook resources. */
  dispose(): void;
}

/** @stability public-experimental */
export interface MogSheetProps {
  /** Raw string/byte sources are not accepted on the public API. */
  src?: never;
  /** Host-resolved source, mode, capability, save, and collaboration request. */
  config: MogEmbedConfig;
  /** Trusted same-origin policy resolver for source and effective state. */
  hostPolicy: MogEmbedHostPolicy;
  /** Container width in pixels */
  width?: number;
  /** Container height in pixels */
  height?: number;
  /** CSS class name for the container */
  className?: string;
  /** CSS style for the container */
  style?: CSSProperties;
  /** Initial sheet index or name */
  sheet?: number | string;
  /** Show sheet tabs (default: true) */
  sheetTabs?: boolean;
  /** Show row/col headers (default: true) */
  headers?: boolean;
  /** Show gridlines (default: true) */
  gridlines?: boolean;
  /** Show formula bar (default: true) */
  formulaBar?: boolean;
  /** Enable scrolling (default: true) */
  scrollable?: boolean;
  /** Show SheetView-owned viewport scrollbars (default: true) */
  scrollbars?: boolean;
  /** Show SheetView-owned zoom controls (default: true) */
  zoomControls?: boolean;
  /** Requested embed mode (default: 'readonly') */
  mode?: EmbedMode;
  /** Locale string */
  locale?: string;
  /**
   * @deprecated Use `config.requestedMode`. Caller values are requests only;
   * the effective mode is returned by `hostPolicy.resolveEffectiveState`.
   */
  /** Callback when ready */
  onReady?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Callback when the selected cell changes. */
  onSelectionChange?: (selection: MogSheetSelection) => void;
  /** Callback when the active sheet changes. */
  onSheetChange?: (sheet: MogSheetChange) => void;
  /** Callback when sheet viewport scroll changes. */
  onScrollChange?: (event: SheetEventScrollChange) => void;
  /** Callback when sheet zoom changes. */
  onZoomChange?: (event: SheetEventZoomChange) => void;
  /** Callback when the workbook dirty flag changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Callback when the save state changes. */
  onSaveStateChange?: (state: 'idle' | 'saving' | 'saved' | 'error') => void;
  /** Callback when a requested capability is denied. */
  onCapabilityDenied?: (info: { capability: string; reason?: string }) => void;
  /** Callback when the effective state changes. */
  onEffectiveStateChange?: (state: MogEmbedEffectiveState) => void;
}

export const MogSheet = forwardRef<MogSheetHandle, MogSheetProps>(function MogSheet(
  {
    config,
    hostPolicy,
    width = 800,
    height = 400,
    className,
    style,
    sheet,
    sheetTabs = true,
    headers = true,
    gridlines = true,
    formulaBar = true,
    scrollable = true,
    scrollbars = true,
    zoomControls = true,
    mode = 'readonly',
    locale,
    onReady,
    onError,
    onSelectionChange,
    onSheetChange,
    onScrollChange,
    onZoomChange,
    onDirtyChange,
    onSaveStateChange,
    onCapabilityDenied,
    onEffectiveStateChange,
  }: MogSheetProps,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<ReactEmbedHostResult['client'] | null>(null);
  const hostRef = useRef<ReactEmbedHostResult | null>(null);
  const rendererRef = useRef<EmbedRenderOrchestrator | null>(null);
  const lastDirtyRef = useRef<boolean | null>(null);
  const effectiveStateRef = useRef<MogEmbedEffectiveState | null>(null);
  // Store callbacks in refs to avoid teardown/re-init on parent re-render
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSheetChangeRef = useRef(onSheetChange);
  const onScrollChangeRef = useRef(onScrollChange);
  const onZoomChangeRef = useRef(onZoomChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  const onCapabilityDeniedRef = useRef(onCapabilityDenied);
  const onEffectiveStateChangeRef = useRef(onEffectiveStateChange);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onSelectionChangeRef.current = onSelectionChange;
  onSheetChangeRef.current = onSheetChange;
  onScrollChangeRef.current = onScrollChange;
  onZoomChangeRef.current = onZoomChange;
  onDirtyChangeRef.current = onDirtyChange;
  onSaveStateChangeRef.current = onSaveStateChange;
  onCapabilityDeniedRef.current = onCapabilityDenied;
  onEffectiveStateChangeRef.current = onEffectiveStateChange;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const emitDirtyChange = (): void => {
    const dirty = clientRef.current?.workbook?.isDirty ?? false;
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
    void hostRef.current
      ?.resolveEffectiveState(dirty)
      .then((state) => {
        effectiveStateRef.current = state;
        onEffectiveStateChangeRef.current?.(state);
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        onErrorRef.current?.(error);
      });
  };

  useImperativeHandle(ref, () => ({
    getStatus: () => clientRef.current?.status ?? 'loading',
    setSheet: async (indexOrName: number | string) => {
      const client = clientRef.current;
      const renderer = rendererRef.current;
      if (!client || client.status !== 'ready') return;
      const ws = await client.setActiveSheet(indexOrName);
      renderer?.updateSheet(ws.getSheetId());
      const names = await client.getSheets();
      const activeIndex = ws.getIndex();
      renderer?.setSheets(
        names.map((name, i) => ({ name, index: i })),
        activeIndex,
      );
      onSheetChangeRef.current?.({
        index: activeIndex,
        name: names[activeIndex] ?? '',
        sheetId: ws.getSheetId(),
      });
      emitDirtyChange();
    },
    isDirty: () => clientRef.current?.workbook?.isDirty ?? false,
    markClean: () => {
      clientRef.current?.workbook?.markClean();
      emitDirtyChange();
    },
    focus: () => {
      containerRef.current?.focus();
      (rendererRef.current as any)?.focus?.();
    },
    requestSave: async () => {
      const state = effectiveStateRef.current;
      const host = hostRef.current;
      if (!host || !host.canRequestSave(state)) {
        onCapabilityDeniedRef.current?.({
          capability: 'save',
          reason: 'Save is not granted by the host policy',
        });
        return false;
      }
      const next = { ...state, saveState: 'saving' as const };
      effectiveStateRef.current = next;
      onSaveStateChangeRef.current?.('saving');
      onEffectiveStateChangeRef.current?.(next);
      try {
        const saved = await host.requestSave(state);
        const done = {
          ...state,
          dirty: saved ? false : state.dirty,
          saveState: saved ? ('saved' as const) : ('error' as const),
        };
        effectiveStateRef.current = done;
        onSaveStateChangeRef.current?.(done.saveState);
        onEffectiveStateChangeRef.current?.(done);
        if (saved) clientRef.current?.workbook?.markClean();
        return saved;
      } catch {
        const failed = { ...state, saveState: 'error' as const };
        effectiveStateRef.current = failed;
        onSaveStateChangeRef.current?.('error');
        onEffectiveStateChangeRef.current?.(failed);
        return false;
      }
    },
    requestExport: async (format: string) => {
      const state = effectiveStateRef.current;
      const host = hostRef.current;
      if (!host || !host.canRequestExport(state)) {
        onCapabilityDeniedRef.current?.({
          capability: 'export',
          reason: 'Export is not granted by the host policy',
        });
        return null;
      }
      return host.requestExport(format, state);
    },
    getEffectiveState: () => effectiveStateRef.current,
    navigateToRange: (range: string) => {
      rendererRef.current?.navigateToRange?.(range);
    },
    resize: () => {
      const container = containerRef.current;
      if (!container || !rendererRef.current) return;
      rendererRef.current.resize(container.clientWidth, container.clientHeight);
    },
    dispose: () => {
      rendererRef.current?.dispose();
      clientRef.current?.dispose();
      rendererRef.current = null;
      clientRef.current = null;
    },
  }));

  // Main effect: create client + renderer (only re-runs on source/config changes)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setLoading(true);
    setError(null);
    lastDirtyRef.current = null;

    // Create renderer (orchestrator)
    const renderer = createEmbedRenderer(container, {
      headers: config.chrome?.headers ?? headers,
      gridlines: config.chrome?.gridlines ?? gridlines,
      formulaBar: config.chrome?.formulaBar ?? formulaBar,
      sheetTabs: config.chrome?.sheetTabs ?? sheetTabs,
      scrollable,
      scrollbars: config.chrome?.scrollbars ?? scrollbars,
      zoomControls: config.chrome?.zoomControls ?? zoomControls,
    });
    rendererRef.current = renderer;

    let disposed = false;
    let host: ReactEmbedHostResult | null = null;
    const offClientListeners: Array<() => void> = [];

    const attachHost = (nextHost: ReactEmbedHostResult): void => {
      host = nextHost;
      hostRef.current = nextHost;
      const nextClient = nextHost.client;
      clientRef.current = nextClient;

      const offReady = nextClient.on('ready', async () => {
        if (disposed) return;
        renderer.attach(nextClient);

        // Update sheet tabs
        try {
          const names = await nextClient.getSheets();
          const activeIndex = nextClient.getActiveSheet().getIndex();
          const sheets = names.map((name, i) => ({ name, index: i }));
          renderer.setSheets(sheets, activeIndex);
        } catch {
          // Ignore sheet tab errors
        }

        setLoading(false);
        onReadyRef.current?.();
        // Build initial effective state
        const dirty = nextClient.workbook?.isDirty ?? false;
        lastDirtyRef.current = dirty;
        try {
          const state = await nextHost.resolveEffectiveState(dirty);
          if (disposed) return;
          effectiveStateRef.current = state;
          onEffectiveStateChangeRef.current?.(state);
          onDirtyChangeRef.current?.(dirty);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setLoading(false);
          onErrorRef.current?.(error);
        }
      });

      const offError = nextClient.on('error', (err) => {
        setError(err);
        setLoading(false);
        onErrorRef.current?.(err);
      });

      offClientListeners.push(offReady, offError);
    };

    void createReactEmbedHost(config, hostPolicy, sheet)
      .then((nextHost) => {
        if (disposed) {
          nextHost.dispose();
          return;
        }
        attachHost(nextHost);
      })
      .catch((err) => {
        if (disposed) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setLoading(false);
        onErrorRef.current?.(error);
      });

    // Wire cell selection from renderer
    const offCellSelect = renderer.on('cellSelect', (cell: { row: number; col: number }) => {
      renderer.setSelectedCell(cell.row, cell.col);
      onSelectionChangeRef.current?.(cell);
      emitDirtyChange();
    });

    // Wire sheet change from renderer tabs
    const offSheetChange = renderer.on('sheetChange', async (index: number) => {
      const currentClient = clientRef.current;
      if (!currentClient || currentClient.status !== 'ready') return;
      try {
        const ws = await currentClient.setActiveSheet(index);
        renderer.updateSheet(ws.getSheetId());
        // Refresh sheet tabs
        const names = await currentClient.getSheets();
        const activeIdx = ws.getIndex();
        renderer.setSheets(
          names.map((name, i) => ({ name, index: i })),
          activeIdx,
        );
        onSheetChangeRef.current?.({
          index: activeIdx,
          name: names[activeIdx] ?? '',
          sheetId: ws.getSheetId(),
        });
        emitDirtyChange();
      } catch {
        // Ignore sheet change errors
      }
    });
    const offScrollChange = renderer.on('scrollChange', (event) => {
      onScrollChangeRef.current?.(event);
    });
    const offZoomChange = renderer.on('zoomChange', (event) => {
      onZoomChangeRef.current?.(event);
    });

    return () => {
      disposed = true;
      for (const off of offClientListeners) off();
      offCellSelect();
      offSheetChange();
      offScrollChange();
      offZoomChange();
      renderer.dispose();
      host?.dispose();
      hostRef.current = null;
      clientRef.current = null;
      rendererRef.current = null;
    };
    // Only re-create on source/config changes — NOT on callback or sheet changes
  }, [
    headers,
    gridlines,
    formulaBar,
    sheetTabs,
    scrollable,
    scrollbars,
    zoomControls,
    mode,
    locale,
    config,
    hostPolicy,
    sheet,
  ]);

  // Controlled sheet navigation: when the `sheet` prop changes after initial
  // mount, navigate without tearing down the whole client/renderer.
  const initialSheetRef = useRef(config?.sheet ?? sheet);
  useEffect(() => {
    const target = config?.sheet ?? sheet;
    if (target === initialSheetRef.current) {
      initialSheetRef.current = undefined;
      return;
    }
    initialSheetRef.current = undefined;
    const client = clientRef.current;
    const renderer = rendererRef.current;
    if (!client || client.status !== 'ready' || target === undefined) return;
    (async () => {
      try {
        const ws = await client.setActiveSheet(target);
        renderer?.updateSheet(ws.getSheetId());
        const names = await client.getSheets();
        const activeIdx = ws.getIndex();
        renderer?.setSheets(
          names.map((name, i) => ({ name, index: i })),
          activeIdx,
        );
        onSheetChangeRef.current?.({
          index: activeIdx,
          name: names[activeIdx] ?? '',
          sheetId: ws.getSheetId(),
        });
        emitDirtyChange();
      } catch {
        // Ignore navigation errors
      }
    })();
  }, [config?.sheet ?? sheet]);

  // Separate effect for size changes (no teardown needed)
  useEffect(() => {
    rendererRef.current?.resize(width, height);
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {loading && !error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#FAFAFA',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 14,
            color: '#999',
            zIndex: 10,
          }}
        >
          Loading spreadsheet...
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#FFF5F5',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 14,
            color: '#CC0000',
            zIndex: 10,
          }}
        >
          Failed to load spreadsheet
        </div>
      )}
    </div>
  );
});

MogSheet.displayName = 'MogSheet';
