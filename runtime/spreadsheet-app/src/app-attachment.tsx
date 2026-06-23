import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CapabilityProvider, PortalContainerProvider, SettingsDialog, ShellHost } from '@mog/shell';
import { ShellProvider } from '@mog/app-spreadsheet';
import { SpreadsheetEmbedRuntimeProvider } from '@mog/app-spreadsheet/embed-runtime';

import {
  SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER,
  type SpreadsheetAttachmentCommandRequest,
  type SpreadsheetRuntimeAttachmentEnvironment,
  type SpreadsheetRuntimeWithAttachmentController,
} from './attachment-runtime';
import { createDeferred, createRuntimeId, type Deferred } from './deferred';
import { ErrorBoundary, SpreadsheetAppPublicError, toPublicError } from './errors';
import { mergeFeatureGates } from './feature-gates';
import type {
  MogSpreadsheetAppProps,
  MogSpreadsheetColorScheme,
  MogSpreadsheetResolvedColorScheme,
  MogSpreadsheetThemePolicy,
  SpreadsheetActiveSheetSnapshot,
  SpreadsheetAppAttachmentHandle,
  SpreadsheetAppError,
  SpreadsheetAppEvent,
  SpreadsheetAppStatus,
  SpreadsheetCommandRequest,
  SpreadsheetSelectionSnapshot,
  SpreadsheetSlotHandle,
  SpreadsheetSlotName,
  SpreadsheetViewHandle,
  SpreadsheetWorkbookSession,
} from './public-types';
import {
  attachRuntimeDefaultVersioning,
  type RegisteredSpreadsheetAppBridge,
  type RuntimeDefaultVersioningAttachmentState,
} from './runtime-types';

type AttachmentBridgeSelection = ReturnType<RegisteredSpreadsheetAppBridge['getSelection']>;
type AttachmentBridgeActiveSheet = ReturnType<RegisteredSpreadsheetAppBridge['getActiveSheet']>;

type StoredAttachmentViewState = {
  selection?: AttachmentBridgeSelection;
  activeSheet?: AttachmentBridgeActiveSheet;
};

type AttachmentRuntimeState = {
  environment: SpreadsheetRuntimeAttachmentEnvironment | null;
  status: SpreadsheetAppStatus;
  error: SpreadsheetAppError | null;
  detached: boolean;
  defaultVersioning: RuntimeDefaultVersioningAttachmentState | null;
};

type EffectiveSpreadsheetTheme = {
  uiColorScheme: MogSpreadsheetColorScheme;
  uiResolvedColorScheme: MogSpreadsheetResolvedColorScheme;
  canvasColorScheme: MogSpreadsheetColorScheme;
  canvasResolvedColorScheme: MogSpreadsheetResolvedColorScheme;
};

type InternalMogSpreadsheetAppProps = MogSpreadsheetAppProps & {
  readonly attachmentIdOverride?: string;
};

function getSystemColorScheme(): MogSpreadsheetResolvedColorScheme {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

function useSystemColorScheme(): MogSpreadsheetResolvedColorScheme {
  const [systemColorScheme, setSystemColorScheme] = useState<MogSpreadsheetResolvedColorScheme>(
    () => getSystemColorScheme(),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemColorScheme(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener?.('change', update);
    return () => {
      query.removeEventListener?.('change', update);
    };
  }, []);

  return systemColorScheme;
}

function resolveThemeAxis(
  axis: MogSpreadsheetThemePolicy['uiChrome'] | undefined,
  systemColorScheme: MogSpreadsheetResolvedColorScheme,
): {
  colorScheme: MogSpreadsheetColorScheme;
  resolvedColorScheme: MogSpreadsheetResolvedColorScheme;
} {
  const colorScheme = axis?.colorScheme ?? 'light';
  const resolvedColorScheme =
    colorScheme === 'system' ? (axis?.resolvedColorScheme ?? systemColorScheme) : colorScheme;

  return { colorScheme, resolvedColorScheme };
}

function resolveSpreadsheetTheme(
  theme: MogSpreadsheetThemePolicy | undefined,
  systemColorScheme: MogSpreadsheetResolvedColorScheme,
): EffectiveSpreadsheetTheme {
  const uiChrome = resolveThemeAxis(theme?.uiChrome, systemColorScheme);
  const canvasChrome = resolveThemeAxis(theme?.canvasChrome, systemColorScheme);

  return {
    uiColorScheme: uiChrome.colorScheme,
    uiResolvedColorScheme: uiChrome.resolvedColorScheme,
    canvasColorScheme: canvasChrome.colorScheme,
    canvasResolvedColorScheme: canvasChrome.resolvedColorScheme,
  };
}

function getThemeAttributes(theme: EffectiveSpreadsheetTheme) {
  return {
    'data-mog-color-scheme': theme.uiResolvedColorScheme,
    'data-mog-ui-color-scheme': theme.uiColorScheme,
    'data-mog-ui-resolved-color-scheme': theme.uiResolvedColorScheme,
    'data-mog-canvas-color-scheme': theme.canvasColorScheme,
    'data-mog-canvas-resolved-color-scheme': theme.canvasResolvedColorScheme,
  } as const;
}

const ACTIVE_WORKBOOK_ATTACHMENTS = new WeakMap<SpreadsheetWorkbookSession, string>();
const WORKBOOK_VIEW_STATE = new WeakMap<SpreadsheetWorkbookSession, StoredAttachmentViewState>();

function createAttachmentError(
  message: string,
  kind: SpreadsheetAppError['kind'],
  props: MogSpreadsheetAppProps,
  attachmentId: string,
  operation: string,
  recoverable = false,
): SpreadsheetAppPublicError {
  return toPublicError(new Error(message), kind, recoverable, {
    runtimeId: props.runtime.runtimeId,
    attachmentId,
    workbookId: props.workbook.workbookId,
    epoch: props.workbook.epoch,
    operation,
  });
}

function claimWorkbookAttachment(
  workbook: SpreadsheetWorkbookSession,
  attachmentId: string,
  runtimeId: string,
): () => void {
  const current = ACTIVE_WORKBOOK_ATTACHMENTS.get(workbook);
  if (current && current !== attachmentId) {
    throw toPublicError(
      new Error(`Workbook "${workbook.workbookId}" already has a full-app UI attachment`),
      'AlreadyAttached',
      false,
      {
        runtimeId,
        attachmentId,
        workbookId: workbook.workbookId,
        epoch: workbook.epoch,
        operation: 'attach',
      },
    );
  }

  ACTIVE_WORKBOOK_ATTACHMENTS.set(workbook, attachmentId);
  return () => {
    if (ACTIVE_WORKBOOK_ATTACHMENTS.get(workbook) === attachmentId) {
      ACTIVE_WORKBOOK_ATTACHMENTS.delete(workbook);
    }
  };
}

function getAttachmentController(props: MogSpreadsheetAppProps, attachmentId: string) {
  const controller = (props.runtime as SpreadsheetRuntimeWithAttachmentController)[
    SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER
  ];
  if (!controller) {
    throw createAttachmentError(
      'SpreadsheetRuntime cannot attach UI because High-water-mark/C has not provided the runtime-owned attachment adapter',
      'AttachFailed',
      props,
      attachmentId,
      'attach',
    );
  }
  return controller;
}

function createAttachmentEvent(
  type: SpreadsheetAppEvent['type'],
  payload: SpreadsheetAppEvent['payload'],
  workbook: SpreadsheetWorkbookSession,
  sequence: number,
): SpreadsheetAppEvent {
  return {
    type,
    workbookId: workbook.workbookId,
    epoch: workbook.epoch,
    sequence,
    source: 'system',
    payload,
  } as SpreadsheetAppEvent;
}

function snapshotSelection(
  workbook: SpreadsheetWorkbookSession,
  snapshot: AttachmentBridgeSelection,
): SpreadsheetSelectionSnapshot {
  return {
    workbookId: workbook.workbookId,
    epoch: workbook.epoch,
    ...snapshot,
  };
}

function snapshotActiveSheet(
  workbook: SpreadsheetWorkbookSession,
  snapshot: AttachmentBridgeActiveSheet,
): SpreadsheetActiveSheetSnapshot {
  return {
    workbookId: workbook.workbookId,
    epoch: workbook.epoch,
    ...snapshot,
  };
}

async function restoreViewState(
  bridge: RegisteredSpreadsheetAppBridge,
  state: StoredAttachmentViewState | undefined,
): Promise<void> {
  if (!state) return;

  const activeSheet = state.activeSheet;
  if (activeSheet?.sheetId) {
    await bridge.setActiveSheet(activeSheet.sheetId);
  }

  const selection = state.selection;
  const firstRange = selection?.selectedRanges[0];
  if (firstRange) {
    await bridge.select({
      sheet: selection.activeSheetId ? String(selection.activeSheetId) : activeSheet?.sheetId,
      range: firstRange,
    });
  }
}

function attachmentUnavailable(
  operation: string,
  props: MogSpreadsheetAppProps,
  attachmentId: string,
): SpreadsheetAppPublicError {
  return createAttachmentError(
    'Spreadsheet app attachment is not mounted',
    'Disposed',
    props,
    attachmentId,
    operation,
  );
}

function commandOwnerFallback(
  props: MogSpreadsheetAppProps,
  environment: SpreadsheetRuntimeAttachmentEnvironment,
  command: SpreadsheetCommandRequest['command'],
) {
  return environment.hostCommands?.getOwner(command) ?? props.commands?.[command] ?? 'mog';
}

function createSlotHandle(
  name: SpreadsheetSlotName,
  assertAttached: (operation: string) => void,
  setSlots: React.Dispatch<React.SetStateAction<Record<string, ReactNode>>>,
): SpreadsheetSlotHandle {
  return {
    name,
    set: (content) => {
      assertAttached('slot.set');
      setSlots((prev) => ({ ...prev, [name]: content }));
    },
    clear: () => {
      assertAttached('slot.clear');
      setSlots((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
  };
}

const MogSpreadsheetAppImpl = forwardRef<
  SpreadsheetAppAttachmentHandle,
  InternalMogSpreadsheetAppProps
>(function MogSpreadsheetAppImpl(props, ref) {
  const attachmentIdRef = useRef(
    props.attachmentIdOverride ?? createRuntimeId('spreadsheet-attachment'),
  );
  const readyRef = useRef<Deferred<void> | null>(null);
  const handleRef = useRef<SpreadsheetAppAttachmentHandle | null>(null);
  const getHandleRef = useRef<() => SpreadsheetAppAttachmentHandle>(() => {
    throw new Error('Spreadsheet app handle requested before initialization');
  });
  const propsRef = useRef(props);
  propsRef.current = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const releaseClaimRef = useRef<(() => void) | null>(null);
  const environmentRef = useRef<SpreadsheetRuntimeAttachmentEnvironment | null>(null);
  const bridgeRef = useRef<RegisteredSpreadsheetAppBridge | null>(null);
  const unregisterBridgeRef = useRef<(() => void) | null>(null);
  const detachPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const readyNotifiedRef = useRef(false);
  const sequenceRef = useRef(0);
  const statusRef = useRef<AttachmentRuntimeState['status']>('loading');
  const detachedRef = useRef(false);
  const errorRef = useRef<SpreadsheetAppError | null>(null);

  const [state, setState] = useState<AttachmentRuntimeState>({
    environment: null,
    status: 'loading',
    error: null,
    detached: false,
    defaultVersioning: null,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slots, setSlots] = useState<Record<string, ReactNode>>(() => ({ ...(props.slots ?? {}) }));

  if (!readyRef.current) {
    readyRef.current = createDeferred<void>();
  }

  const attachmentId = attachmentIdRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSlots({ ...(props.slots ?? {}) });
  }, [props.slots]);

  const nextSequence = useCallback(() => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  }, []);

  const notifyError = useCallback(
    (error: SpreadsheetAppError) => {
      propsRef.current.onError?.(error);
      propsRef.current.onEvent?.(
        createAttachmentEvent('error', error, propsRef.current.workbook, nextSequence()),
      );
    },
    [nextSequence],
  );

  const assertAttached = useCallback(
    (operation: string) => {
      if (detachedRef.current || statusRef.current === 'disposed') {
        throw attachmentUnavailable(operation, propsRef.current, attachmentId);
      }
    },
    [attachmentId],
  );

  const detachCurrent = useCallback(
    async (operation = 'detach'): Promise<void> => {
      if (detachPromiseRef.current) return detachPromiseRef.current;

      detachPromiseRef.current = (async () => {
        if (detachedRef.current) return;
        detachedRef.current = true;
        statusRef.current = 'disposed';

        const bridge = bridgeRef.current;
        if (bridge) {
          try {
            await bridge.commitEdit();
          } catch {
            try {
              await bridge.cancelEdit();
            } catch {
              // The attachment is already going away; stale editor cleanup must
              // not keep the session attached.
            }
          }
        }

        const unregister = unregisterBridgeRef.current;
        unregisterBridgeRef.current = null;
        unregister?.();
        bridgeRef.current = null;

        const environment = environmentRef.current;
        environmentRef.current = null;

        try {
          await environment?.detach();
        } catch (detachError) {
          const publicError = toPublicError(detachError, 'DetachFailed', true, {
            runtimeId: propsRef.current.runtime.runtimeId,
            attachmentId,
            workbookId: propsRef.current.workbook.workbookId,
            epoch: propsRef.current.workbook.epoch,
            operation,
          });
          errorRef.current = publicError;
          notifyError(publicError);
          throw publicError;
        } finally {
          releaseClaimRef.current?.();
          releaseClaimRef.current = null;
          if (mountedRef.current) {
            setState((prev) => ({
              ...prev,
              environment: null,
              status: 'disposed',
              detached: true,
            }));
          }
          propsRef.current.onDisposed?.();
        }
      })();

      return detachPromiseRef.current;
    },
    [attachmentId, notifyError],
  );

  const resolveReady = useCallback(() => {
    if (readyNotifiedRef.current || detachedRef.current) return;
    const handle = getHandleRef.current();
    readyNotifiedRef.current = true;
    readyRef.current?.resolve();
    propsRef.current.onReady?.(handle);
  }, []);

  const registerAppBridge = useCallback(
    (bridge: RegisteredSpreadsheetAppBridge): (() => void) => {
      const environment = environmentRef.current;
      if (!environment) return () => {};

      const previous = unregisterBridgeRef.current;
      unregisterBridgeRef.current = null;
      previous?.();

      bridgeRef.current = bridge;
      const workbook = propsRef.current.workbook;
      const storeState = () => {
        WORKBOOK_VIEW_STATE.set(workbook, {
          selection: bridge.getSelection(),
          activeSheet: bridge.getActiveSheet(),
        });
      };

      const emitSelection = (snapshot: AttachmentBridgeSelection) => {
        const payload = snapshotSelection(workbook, snapshot);
        propsRef.current.onSelectionChange?.(payload);
        propsRef.current.onEvent?.(
          createAttachmentEvent('selection-change', payload, workbook, nextSequence()),
        );
      };
      const emitActiveSheet = (snapshot: AttachmentBridgeActiveSheet) => {
        const payload = snapshotActiveSheet(workbook, snapshot);
        propsRef.current.onActiveSheetChange?.(payload);
        propsRef.current.onEvent?.(
          createAttachmentEvent('active-sheet-change', payload, workbook, nextSequence()),
        );
      };

      const unregisterEnvironmentBridge = environment.registerAppBridge(bridge);
      const unsubscribeSelection = bridge.onSelectionChange((snapshot) => {
        storeState();
        emitSelection(snapshot);
      });
      const unsubscribeActiveSheet = bridge.onActiveSheetChange((snapshot) => {
        storeState();
        emitActiveSheet(snapshot);
      });

      void restoreViewState(bridge, WORKBOOK_VIEW_STATE.get(workbook)).catch((restoreError) => {
        notifyError(
          toPublicError(restoreError, 'AttachFailed', true, {
            runtimeId: propsRef.current.runtime.runtimeId,
            attachmentId,
            workbookId: workbook.workbookId,
            epoch: workbook.epoch,
            operation: 'restoreViewState',
          }),
        );
      });

      storeState();
      emitSelection(bridge.getSelection());
      emitActiveSheet(bridge.getActiveSheet());
      resolveReady();

      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        try {
          storeState();
        } catch {
          // The app bridge may already have torn down its coordinator.
        }
        unsubscribeSelection();
        unsubscribeActiveSheet();
        unregisterEnvironmentBridge();
        if (bridgeRef.current === bridge) {
          bridgeRef.current = null;
        }
        if (unregisterBridgeRef.current === cleanup) {
          unregisterBridgeRef.current = null;
        }
      };

      unregisterBridgeRef.current = cleanup;
      return cleanup;
    },
    [attachmentId, nextSequence, notifyError, resolveReady],
  );

  const viewHandle = useMemo<SpreadsheetViewHandle>(
    () => ({
      scrollTo: async (input) => {
        assertAttached('view.scrollTo');
        const bridge = bridgeRef.current;
        if (!bridge) throw attachmentUnavailable('view.scrollTo', propsRef.current, attachmentId);
        await bridge.scrollTo(input);
      },
      select: async (input) => {
        assertAttached('view.select');
        const bridge = bridgeRef.current;
        if (!bridge) throw attachmentUnavailable('view.select', propsRef.current, attachmentId);
        await bridge.select(input);
      },
      getSelection: () => {
        assertAttached('view.getSelection');
        const bridge = bridgeRef.current;
        if (bridge) return snapshotSelection(propsRef.current.workbook, bridge.getSelection());
        const stored = WORKBOOK_VIEW_STATE.get(propsRef.current.workbook)?.selection;
        return snapshotSelection(
          propsRef.current.workbook,
          stored ?? { selectedRanges: [], activeCell: null },
        );
      },
      getActiveSheet: () => {
        assertAttached('view.getActiveSheet');
        const bridge = bridgeRef.current;
        if (bridge) return snapshotActiveSheet(propsRef.current.workbook, bridge.getActiveSheet());
        const stored = WORKBOOK_VIEW_STATE.get(propsRef.current.workbook)?.activeSheet;
        if (stored) return snapshotActiveSheet(propsRef.current.workbook, stored);
        throw attachmentUnavailable('view.getActiveSheet', propsRef.current, attachmentId);
      },
      setActiveSheet: async (sheetIdOrName) => {
        assertAttached('view.setActiveSheet');
        const bridge = bridgeRef.current;
        if (!bridge)
          throw attachmentUnavailable('view.setActiveSheet', propsRef.current, attachmentId);
        await bridge.setActiveSheet(sheetIdOrName);
      },
      startEdit: async (input) => {
        assertAttached('view.startEdit');
        const bridge = bridgeRef.current;
        if (!bridge) throw attachmentUnavailable('view.startEdit', propsRef.current, attachmentId);
        await bridge.startEdit(input);
      },
      commitEdit: async () => {
        assertAttached('view.commitEdit');
        const bridge = bridgeRef.current;
        if (!bridge) throw attachmentUnavailable('view.commitEdit', propsRef.current, attachmentId);
        await bridge.commitEdit();
      },
      cancelEdit: async () => {
        assertAttached('view.cancelEdit');
        const bridge = bridgeRef.current;
        if (!bridge) throw attachmentUnavailable('view.cancelEdit', propsRef.current, attachmentId);
        await bridge.cancelEdit();
      },
      blur: () => {
        if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
      canExecute: async (command) => {
        const environment = environmentRef.current;
        if (!environment) {
          return {
            decision: 'denied',
            policyVersion: 'spreadsheet-app-attachment',
            reason: 'Attachment is not mounted',
          };
        }
        return commandOwnerFallback(propsRef.current, environment, command) === 'disabled'
          ? {
              decision: 'denied',
              policyVersion: 'spreadsheet-app-attachment',
              reason: `${command} is disabled by host policy`,
            }
          : { decision: 'allowed', policyVersion: 'spreadsheet-app-attachment' };
      },
    }),
    [assertAttached, attachmentId],
  );

  const getHandle = useCallback((): SpreadsheetAppAttachmentHandle => {
    if (handleRef.current) return handleRef.current;
    const handle: SpreadsheetAppAttachmentHandle = {
      ready: readyRef.current!.promise,
      attachmentId,
      workbookId: props.workbook.workbookId,
      workbook: props.workbook,
      getStatus: () => {
        if (detachedRef.current) return 'disposed';
        if (errorRef.current) return 'error';
        return environmentRef.current?.getStatus?.() ?? statusRef.current;
      },
      view: () => {
        assertAttached('view');
        return viewHandle;
      },
      slot: (name) => createSlotHandle(name, assertAttached, setSlots),
      focus: () => {
        if (detachedRef.current) return;
        rootRef.current?.focus();
      },
      resize: () => {
        if (detachedRef.current) return;
        window.dispatchEvent(new Event('resize'));
      },
      detach: () => detachCurrent('detach'),
    };
    handleRef.current = handle;
    return handle;
  }, [assertAttached, attachmentId, detachCurrent, props.workbook, viewHandle]);

  getHandleRef.current = getHandle;

  useImperativeHandle(ref, getHandle, [getHandle]);

  useEffect(() => {
    let cancelled = false;

    detachedRef.current = false;
    detachPromiseRef.current = null;
    statusRef.current = 'loading';
    errorRef.current = null;
    readyNotifiedRef.current = false;
    setState({
      environment: null,
      status: 'loading',
      error: null,
      detached: false,
      defaultVersioning: null,
    });

    void (async () => {
      const release = claimWorkbookAttachment(
        props.workbook,
        attachmentId,
        props.runtime.runtimeId,
      );
      releaseClaimRef.current = release;

      const controller = getAttachmentController(props, attachmentId);
      const environment = await controller.attach({
        attachmentId,
        workbook: props.workbook,
        props: {
          workspace: props.workspace,
          chrome: props.chrome,
          commands: props.commands,
          featurePolicy: props.featurePolicy,
          editModel: props.editModel,
          portals: props.portals,
          slots: props.slots,
        },
      });

      if (cancelled) {
        await environment.detach();
        release();
        return;
      }

      const defaultVersioning = attachRuntimeDefaultVersioning(environment);
      environmentRef.current = environment;
      statusRef.current = 'ready';
      if (mountedRef.current) {
        setState({ environment, status: 'ready', error: null, detached: false, defaultVersioning });
      }
    })().catch((attachError) => {
      releaseClaimRef.current?.();
      releaseClaimRef.current = null;
      const publicError = toPublicError(attachError, 'AttachFailed', true, {
        runtimeId: props.runtime.runtimeId,
        attachmentId,
        workbookId: props.workbook.workbookId,
        epoch: props.workbook.epoch,
        operation: 'attach',
      });
      errorRef.current = publicError;
      statusRef.current = 'error';
      if (mountedRef.current) {
        setState({
          environment: null,
          status: 'error',
          error: publicError,
          detached: false,
          defaultVersioning: null,
        });
      }
      readyRef.current?.reject(publicError);
      notifyError(publicError);
    });

    return () => {
      cancelled = true;
      void detachCurrent('react-unmount');
    };
    // Runtime/workbook identity changes require a new full-app attachment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runtime, props.workbook]);

  const environment = state.environment;
  const effectiveFeatureGates = useMemo(
    () =>
      mergeFeatureGates(props.featurePolicy, props.chrome, props.commands, props.editModel, {
        versionControl: state.defaultVersioning?.status === 'attached',
      }),
    [props.featurePolicy, props.chrome, props.commands, props.editModel, state.defaultVersioning],
  );

  const hostCommands = useMemo(
    () => ({
      getOwner: (command: SpreadsheetCommandRequest['command']) => {
        const currentProps = propsRef.current;
        if (!environment) return currentProps.commands?.[command] ?? 'mog';
        return commandOwnerFallback(currentProps, environment, command);
      },
      request: async (request: SpreadsheetAttachmentCommandRequest) => {
        if (!environment?.hostCommands) return { status: 'not-handled' as const };
        return environment.hostCommands.request(request);
      },
    }),
    [environment],
  );

  const embedRuntimeValue = useMemo(
    () => ({
      documentId: environment?.documentId,
      hostCommands,
      slots,
      registerAppBridge,
    }),
    [environment?.documentId, hostCommands, registerAppBridge, slots],
  );

  const handleOpenSettings = useCallback(() => {
    if (props.workspace?.settings === false) return;
    setSettingsOpen(true);
  }, [props.workspace?.settings]);

  const propUiColorScheme = props.theme?.uiChrome?.colorScheme ?? 'light';
  const [settingsUiColorScheme, setSettingsUiColorScheme] =
    useState<MogSpreadsheetColorScheme>(propUiColorScheme);

  useEffect(() => {
    setSettingsUiColorScheme(propUiColorScheme);
  }, [propUiColorScheme]);

  const systemColorScheme = useSystemColorScheme();
  const settingsTheme = useMemo<MogSpreadsheetThemePolicy>(
    () => ({
      ...props.theme,
      uiChrome: {
        ...props.theme?.uiChrome,
        colorScheme: settingsUiColorScheme,
      },
    }),
    [props.theme, settingsUiColorScheme],
  );
  const effectiveTheme = useMemo(
    () => resolveSpreadsheetTheme(settingsTheme, systemColorScheme),
    [settingsTheme, systemColorScheme],
  );
  const themeAttributes = useMemo(() => getThemeAttributes(effectiveTheme), [effectiveTheme]);

  if (state.detached) return null;

  if (state.error) {
    return (
      <div
        className={['mog-spreadsheet-app-root', props.className].filter(Boolean).join(' ')}
        data-mog-engine=""
        style={{ width: '100%', height: '100%', minHeight: 0, ...props.style }}
      >
        <div className="mog-spreadsheet-app-theme-scope" {...themeAttributes}>
          <div className="mog-spreadsheet-app-error">{state.error.message}</div>
        </div>
      </div>
    );
  }

  const showAppSwitcher = props.workspace?.appSwitcher ?? false;
  const showFileExplorer = props.workspace?.fileExplorer ?? false;
  const belowCommandBar = slots['below-command-bar'];

  return (
    <div
      ref={rootRef}
      className={['mog-spreadsheet-app-root', props.className].filter(Boolean).join(' ')}
      data-mog-engine=""
      style={{ width: '100%', height: '100%', minHeight: 0, ...props.style }}
      tabIndex={-1}
    >
      <div className="mog-spreadsheet-app-theme-scope" {...themeAttributes}>
        {environment ? (
          <CapabilityProvider registry={environment.capabilityRegistry}>
            <ShellProvider shell={environment.shell}>
              <SpreadsheetEmbedRuntimeProvider value={embedRuntimeValue}>
                <ErrorBoundary onError={props.onError}>
                  <PortalContainerProvider>
                    <ShellHost
                      kernel={environment.appKernel}
                      header={null}
                      showAppSwitcher={showAppSwitcher}
                      showFileExplorer={showFileExplorer}
                      onOpenSettings={handleOpenSettings}
                      featureGates={effectiveFeatureGates}
                      loadingFallback={props.loadingFallback}
                      appearanceMode={effectiveTheme.uiColorScheme}
                      onAppearanceModeChange={setSettingsUiColorScheme}
                    >
                      {belowCommandBar ? (
                        <div
                          data-mog-spreadsheet-slot="below-command-bar"
                          className="mog-spreadsheet-app-slot mog-spreadsheet-app-slot-below-command-bar"
                        >
                          {belowCommandBar}
                        </div>
                      ) : null}
                    </ShellHost>
                    {props.workspace?.settings !== false && (
                      <SettingsDialog
                        open={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                        appearanceMode={effectiveTheme.uiColorScheme}
                        onAppearanceModeChange={setSettingsUiColorScheme}
                      />
                    )}
                  </PortalContainerProvider>
                </ErrorBoundary>
              </SpreadsheetEmbedRuntimeProvider>
            </ShellProvider>
          </CapabilityProvider>
        ) : (
          (props.loadingFallback ?? (
            <div className="mog-spreadsheet-app-loading">{state.status}</div>
          ))
        )}
      </div>
    </div>
  );
});

MogSpreadsheetAppImpl.displayName = 'MogSpreadsheetAppImpl';

export const MogSpreadsheetApp = forwardRef<SpreadsheetAppAttachmentHandle, MogSpreadsheetAppProps>(
  function MogSpreadsheetApp(props, ref) {
    return <MogSpreadsheetAppImpl ref={ref} {...props} />;
  },
);

MogSpreadsheetApp.displayName = 'MogSpreadsheetApp';

type MountedSpreadsheetAppHandle = SpreadsheetAppAttachmentHandle & {
  readonly __ready: Deferred<void>;
};

function requireMountedHandle(
  ref: React.RefObject<SpreadsheetAppAttachmentHandle | null>,
  operation: string,
  props: MogSpreadsheetAppProps,
  attachmentId: string,
): SpreadsheetAppAttachmentHandle {
  const handle = ref.current;
  if (!handle) {
    throw attachmentUnavailable(operation, props, attachmentId);
  }
  return handle;
}

function createMountedHandle(
  ref: React.RefObject<SpreadsheetAppAttachmentHandle | null>,
  props: MogSpreadsheetAppProps,
  attachmentId: string,
): MountedSpreadsheetAppHandle {
  const ready = createDeferred<void>();

  return {
    __ready: ready,
    ready: ready.promise,
    attachmentId,
    workbookId: props.workbook.workbookId,
    workbook: props.workbook,
    getStatus: () => ref.current?.getStatus() ?? 'loading',
    view: () => requireMountedHandle(ref, 'view', props, attachmentId).view(),
    slot: (name) => requireMountedHandle(ref, 'slot', props, attachmentId).slot(name),
    focus: () => ref.current?.focus(),
    resize: () => ref.current?.resize(),
    detach: async () => {
      await ref.current?.detach();
    },
  };
}

export function mountSpreadsheetApp(
  container: HTMLElement,
  props: MogSpreadsheetAppProps,
): SpreadsheetAppAttachmentHandle {
  const root: Root = createRoot(container);
  const attachmentId = createRuntimeId('spreadsheet-attachment');
  const ref = React.createRef<SpreadsheetAppAttachmentHandle>();
  const mounted = createMountedHandle(ref, props, attachmentId);

  root.render(
    <MogSpreadsheetAppImpl
      ref={(value) => {
        ref.current = value;
        if (value) {
          value.ready.then(
            () => mounted.__ready.resolve(),
            (readyError) => mounted.__ready.reject(readyError),
          );
        }
      }}
      attachmentIdOverride={attachmentId}
      {...props}
    />,
  );

  const { __ready: _ready, ...publicHandle } = mounted;
  return {
    ...publicHandle,
    detach: async () => {
      await ref.current?.detach();
      root.unmount();
    },
  };
}
