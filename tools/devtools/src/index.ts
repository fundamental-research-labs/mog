import { DevToolsBroadcaster } from './bridge/broadcast-channel';
import { createConsoleAPI } from './console/api';
import { getActiveComputeBridge } from './console/viewport-inspector';
import { EventStore } from './event-store';
import { setupGlobalHook } from './global-hook';
import { openDevToolsWindow } from './open-devtools-window';
import { ActorRecorder } from './recorders/actor-recorder';
import type {
  CellSnapshotData,
  SceneGraphSnapshotObject,
  ViewportSnapshotCell,
  ViewportSnapshotViewport,
} from './types';

export { EventStore } from './event-store';
export type { StoreListener } from './event-store';
export { ActorRecorder } from './recorders/actor-recorder';
export type {
  ActorEvent,
  ActionDispatchEvent,
  BridgeCallEvent,
  CanvasFrameEvent,
  DevToolsConsoleAPI,
  DevToolsStatus,
  DrawingDescriptor,
  DrawingKind,
  EventBusEvent,
  FlowEntryMeta,
  FlowEventSource,
  FlowEventTimingMeta,
  MachineSnapshot,
  OSDevToolsHook,
  PixelRect,
  ProgrammaticCellValue,
  ProgrammaticFlow,
  ProgrammaticFlowAction,
  ProgrammaticFlowBridgeCall,
  ProgrammaticFlowGuardRejection,
  ProgrammaticFlowReceipt,
  ProgrammaticFlowTransition,
  ProgrammaticFlowViewportUpdate,
  ProgrammaticMachineState,
  RenderEvent,
  RuntimeEvent,
  StoreEntry,
} from './types';
export { openDevToolsWindow } from './open-devtools-window';
export { DebugRecorder, captureAppState } from './recorders/debug-recorder';
export type {
  AppStateSnapshot,
  BugReport,
  DebugRecordingBundle,
  LogEntry,
  StateTransition,
} from './recorders/debug-recorder-types';

/**
 * Initialize OS DevTools. Call once at app startup (dev mode only).
 * Sets up window.__OS_DEVTOOLS__ (runtimes report in), window.__dt (console API),
 * BroadcastChannel bridge for the separate DevTools window, and Cmd+Shift+D shortcut.
 */
export function setupDevTools(): void {
  if (typeof window === 'undefined') return;

  // Don't double-initialize
  if (window.__OS_DEVTOOLS__) {
    console.warn('[OS DevTools] Already initialized');
    return;
  }

  const store = new EventStore();
  const actorRecorder = new ActorRecorder(store);

  // Set up BroadcastChannel bridge for the separate DevTools window
  const broadcaster = new DevToolsBroadcaster();
  store.setBroadcaster(broadcaster);

  // Set up the global hook (runtimes call into this)
  setupGlobalHook(store, actorRecorder);

  // Set up the console API (humans/agents query this)
  const api = createConsoleAPI(store, actorRecorder);
  window.__dt = api;

  // Handle commands from the DevTools window
  broadcaster.onCommand((msg) => {
    if (msg.type === 'command') {
      switch (msg.command) {
        case 'enable':
          store.enable();
          break;
        case 'disable':
          store.disable();
          break;
        case 'clear': {
          store.clear();
          actorRecorder.machines.clear();
          break;
        }
      }
      // Send updated status back so DevTools window reflects the change
      broadcaster.sendStatusUpdate(api.getStatus());
    } else if (msg.type === 'request-snapshot') {
      broadcaster.sendSnapshot({
        events: store.all(),
        machines: Object.fromEntries(actorRecorder.machines),
      });
      // Also send current status
      broadcaster.sendStatusUpdate(api.getStatus());
    } else if (msg.type === 'request-viewport-snapshot') {
      try {
        const bridge = getActiveComputeBridge();
        if (!bridge) {
          broadcaster.sendViewportSnapshot({ viewports: [] });
          return;
        }
        const vpStates: ReadonlyMap<string, any> = bridge.getPerViewportStates();
        const viewports: ViewportSnapshotViewport[] = [];
        for (const [id] of vpStates) {
          const buf = bridge.getViewportBuffer?.(id);
          if (!buf || !buf.hasBuffer()) continue;
          const startRow = buf.getStartRow();
          const startCol = buf.getStartCol();
          const rows = buf.getRows();
          const cols = buf.getCols();
          // Sample up to 20x20 cells from the buffer
          const sampleRows = Math.min(rows, 20);
          const sampleCols = Math.min(cols, 20);
          const sampleCells: ViewportSnapshotCell[] = [];
          const accessor = buf.createAccessor();
          for (let r = 0; r < sampleRows; r++) {
            for (let c = 0; c < sampleCols; c++) {
              const row = startRow + r;
              const col = startCol + c;
              if (accessor.moveTo(row, col)) {
                sampleCells.push({
                  row,
                  col,
                  valueType: accessor.valueType,
                  numberValue: accessor.numberValue,
                  displayText: accessor.displayText,
                  hasFormula: accessor.hasFormula,
                  formatIdx: accessor.formatIdx,
                });
              }
            }
          }
          viewports.push({
            id,
            startRow,
            startCol,
            rows,
            cols,
            generation: buf.getGeneration(),
            stringPoolBytes: 0, // not directly exposed, use 0
            overflowPoolBytes: 0,
            formatPaletteSize: 0,
            cellCount: buf.getCellCount(),
            sampleCells,
          });
        }
        broadcaster.sendViewportSnapshot({ viewports });
      } catch (e) {
        broadcaster.sendViewportSnapshot({ viewports: [] });
      }
    } else if (msg.type === 'request-scenegraph-snapshot') {
      try {
        // The scene graph is the renderer's authoritative source — it
        // lives on the SheetView object-scene capability, not on the
        // kernel document context.
        const coordinator = (window as any).__COORDINATOR__;
        const sceneObjects =
          coordinator?.renderer?.getSheetView?.()?.objects?.getSceneObjectsByZOrder?.() ?? [];
        const objects: SceneGraphSnapshotObject[] = [];
        for (const obj of sceneObjects) {
          objects.push({
            id: obj.id,
            type: obj.type,
            bounds: {
              x: obj.bounds.x,
              y: obj.bounds.y,
              width: obj.bounds.width,
              height: obj.bounds.height,
            },
            zIndex: obj.zIndex,
            visible: obj.visible,
            locked: obj.locked ?? false,
            opacity: obj.opacity ?? 1,
            groupId: obj.groupId,
            rotation: obj.rotation ?? 0,
          });
        }
        broadcaster.sendSceneGraphSnapshot({ objects });
      } catch (e) {
        broadcaster.sendSceneGraphSnapshot({ objects: [] });
      }
    } else if (msg.type === 'request-cell-snapshot') {
      try {
        const { row, col, viewportId } = msg.payload;
        const bridge = getActiveComputeBridge();
        if (!bridge) return;
        const vpStates: ReadonlyMap<string, any> = bridge.getPerViewportStates();

        const tryViewport = (vpId: string): CellSnapshotData | null => {
          const vpState = vpStates.get(vpId);
          const buf = vpState?.buffer;
          if (!buf?.hasBuffer()) return null;
          const accessor = buf.createAccessor();
          if (!accessor.moveTo(row, col)) return null;
          return {
            row,
            col,
            viewportId: vpId,
            valueType: accessor.valueType,
            numberValue: accessor.numberValue,
            displayText: accessor.displayText,
            errorText: accessor.errorText,
            hasFormula: accessor.hasFormula,
            hasComment: accessor.hasComment,
            hasSparkline: accessor.hasSparkline,
            hasHyperlink: accessor.hasHyperlink,
            isCheckbox: accessor.isCheckbox,
            hasValidationError: accessor.hasValidationError,
            formatIdx: accessor.formatIdx,
            format: accessor.format ? JSON.parse(JSON.stringify(accessor.format)) : null,
            flags: accessor.flags,
            bgColorOverride: accessor.getBgColorOverride?.() ?? null,
            fontColorOverride: accessor.getFontColorOverride?.() ?? null,
          };
        };

        if (viewportId) {
          const result = tryViewport(viewportId);
          if (result) broadcaster.sendCellSnapshot(result);
        } else {
          for (const [vpId] of vpStates) {
            const result = tryViewport(vpId);
            if (result) {
              broadcaster.sendCellSnapshot(result);
              return;
            }
          }
        }
      } catch (e) {
        // silently fail
      }
    }
  });

  // Keyboard shortcut: Cmd+Shift+D / Ctrl+Shift+D opens DevTools window
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      openDevToolsWindow().catch((err) => {
        console.error('[OS DevTools] Failed to open DevTools window:', err);
      });
    }
  });

  console.log(
    '%c[OS DevTools]%c Initialized. Use %c__dt.machines()%c to start. Press Cmd+Shift+D to open DevTools window.',
    'color: #61afef; font-weight: bold;',
    'color: inherit;',
    'color: #98c379; font-weight: bold;',
    'color: inherit;',
  );
}

// Auto-initialize when imported
setupDevTools();
