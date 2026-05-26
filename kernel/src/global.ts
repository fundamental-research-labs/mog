/**
 * Global type declarations for kernel package.
 *
 * Extends the Window interface with optional globals used by the kernel:
 * - __OS_DEVTOOLS__: Installed by @mog/devtools' setupGlobalHook() in dev mode.
 *   Typed here structurally (not imported from @mog/devtools) so that
 *   compute-core packages do not gain a runtime dependency on devtools.
 *   The canonical shape is `OSDevToolsHook` in @mog/devtools;
 *   the structural subset below must stay in sync with methods invoked
 *   across kernel/shell/apps/spreadsheet/canvas.
 * - __SHELL__: Installed by dev/app's bootstrap (window.__SHELL__ = shell)
 *   to expose shell services to devtools and test harnesses in dev mode.
 * - Handwriting: Web Handwriting API for ink recognition.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OSDevToolsViewportBufferEvent {
  kind: 'mutation-applied' | 'full-refresh' | 'delta-applied';
  viewportId: string;
  patchCount: number;
  skippedOutOfBounds: number;
  bufferBounds: {
    startRow: number;
    startCol: number;
    rows: number;
    cols: number;
  };
  generation: number;
  overflowPoolBytes: number;
  sampleCells?: Array<{ row: number; col: number; displayText: string | null }>;
  correlationId?: number;
}

declare global {
  /**
   * Shared ambient devtools hook contract. Kernel declares the production-safe
   * reporting subset without importing @mog/devtools; devtools augments this
   * same global interface with its additional methods.
   */
  interface OSDevToolsHook {
    reportActor(actorId: string, inspectionEvent: unknown): void;
    reportRender(
      appId: string,
      componentId: string,
      phase: string,
      actualDurationMs: number,
      baseDurationMs: number,
    ): void;
    reportEvent(event: { type: string }): void;
    reportBridgeCall(
      bridge: string,
      method: string,
      args: unknown[],
      durationMs: number,
      result: unknown,
      error?: string,
    ): void;
    reportViewportBuffer(event: OSDevToolsViewportBufferEvent): void;
    reportAction(
      action: string,
      durationMs: number,
      result: { handled: boolean; error?: string; receipts?: unknown[] },
      payload?: unknown,
    ): void;
    reportReceipt(
      receipts: Array<{
        domain: string;
        action: string;
        id: string;
        bounds?: unknown;
        object?: unknown;
      }>,
    ): void;
    reportCanvasFrame(
      layerTimings: Record<string, { lastMs: number; avgMs: number; maxMs: number }>,
      bufferGeneration?: number,
    ): void;
  }

  interface Window {
    /** Web Handwriting Recognition API (Chrome origin trial) */
    Handwriting?: {
      createRecognizer: (options: { languages: string[] }) => Promise<any>;
    };

    /** Devtools hook installed by @mog/devtools in dev mode (undefined in prod) */
    __OS_DEVTOOLS__?: OSDevToolsHook;

    /** Shell services exposed for devtools/testing in dev mode */
    __SHELL__?: {
      store: unknown;
      documentManager: unknown;
      eventDispatcher: unknown;
      dispose(): void;
    };

    /** Tauri IPC global — present when running inside a Tauri webview */
    __TAURI__?: {
      invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
    };
  }
}

export {};
