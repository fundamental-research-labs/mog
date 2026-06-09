import {
  createSpreadsheetRuntime,
  mountSpreadsheetApp,
  type MogSpreadsheetColorScheme,
  type SpreadsheetAppAttachmentHandle,
  type SpreadsheetCommandRequest,
  type SpreadsheetCommandResult,
  type SpreadsheetDirtyState,
  type SpreadsheetExportRequest,
  type SpreadsheetRuntime,
  type SpreadsheetRuntimeOptions,
  type SpreadsheetSaveRequest,
  type SpreadsheetSaveResult,
  type SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';
import type { ExtensionToWebview, SaveResultPayload, WebviewAssets } from '../src/protocol.js';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

type PendingHostSave = {
  readonly request: SpreadsheetSaveRequest;
  readonly resolve: (result: SpreadsheetSaveResult) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: number;
};

const vscode: VsCodeApi = acquireVsCodeApi();
const root = requireRoot();

let runtime: SpreadsheetRuntime | null = null;
let workbook: SpreadsheetWorkbookSession | null = null;
let attachment: SpreadsheetAppAttachmentHandle | null = null;
let unsubscribeDirty: (() => void) | null = null;
let activeColorScheme: MogSpreadsheetColorScheme = 'system';
let initGeneration = 0;
const pendingHostSaves = new Map<string, PendingHostSave>();
const requestedSaveIds: string[] = [];

function requireRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) {
    throw new Error('Mog Spreadsheet root element is missing');
  }
  return element;
}

function post(message: unknown): void {
  vscode.postMessage(message);
}

function bytesToNumberArray(bytes: Uint8Array | ArrayBuffer): number[] {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view);
}

function numberArrayToBytes(bytes: readonly number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function postError(operation: string, error: unknown, requestId?: string): void {
  post({
    type: 'error',
    operation,
    message: errorMessage(error),
    requestId,
    stack: errorStack(error),
  });
}

function setRootState(state: string): void {
  root.dataset.mogVscodeState = state;
}

function renderFallback(text: string): void {
  root.innerHTML = '';
  const fallback = document.createElement('div');
  fallback.className = 'mog-vscode-fallback';
  fallback.textContent = text;
  root.appendChild(fallback);
}

function renderError(error: unknown): void {
  root.innerHTML = '';
  const node = document.createElement('pre');
  node.className = 'mog-vscode-error';
  node.textContent = errorStack(error) ?? errorMessage(error);
  root.appendChild(node);
}

function markReadyForTests(): void {
  root.dataset.mogReady = 'true';
}

function dirtyPayload(state: SpreadsheetDirtyState): {
  readonly type: 'dirty-change';
  readonly dirty: boolean;
  readonly changeSequence: number;
} {
  return {
    type: 'dirty-change',
    dirty: state.status === 'dirty',
    changeSequence: state.changeSequence,
  };
}

async function disposeCurrent(): Promise<void> {
  unsubscribeDirty?.();
  unsubscribeDirty = null;
  const currentAttachment = attachment;
  const currentRuntime = runtime;
  attachment = null;
  workbook = null;
  runtime = null;

  for (const pending of pendingHostSaves.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('Workbook was disposed before host save completed'));
  }
  pendingHostSaves.clear();
  requestedSaveIds.length = 0;

  try {
    await currentAttachment?.detach();
  } finally {
    await currentRuntime?.dispose();
  }
}

function runtimeOptions(assets: WebviewAssets): SpreadsheetRuntimeOptions {
  return {
    assets,
    host: {
      persistenceMode: 'host-owned-ephemeral',
      beforeUnloadPrompt: false,
    },
    onSaveRequest: (request) => postHostSaveRequest(request),
    onCommandRequest: (request) => handleHostCommand(request),
    onEvent: (event) => {
      if (event.type === 'error') {
        postError('runtime-event', event.payload);
      }
    },
  };
}

async function handleHostCommand(
  request: SpreadsheetCommandRequest,
): Promise<SpreadsheetCommandResult> {
  if (request.command === 'save' && request.save) {
    const result = await postHostSaveRequest(request.save);
    return { status: 'handled', command: 'save', result };
  }

  if (request.command === 'export' && request.export?.format === 'xlsx') {
    await postHostExportRequest(request.export);
    return { status: 'handled', command: 'export' };
  }

  if (request.command === 'open' || request.command === 'import') {
    return {
      status: 'denied',
      command: request.command,
      reason: 'VS Code owns file open/import for this custom editor.',
    };
  }

  return {
    status: 'denied',
    command: request.command,
    reason: `${request.command} is disabled in the VS Code host.`,
  };
}

function postHostSaveRequest(request: SpreadsheetSaveRequest): Promise<SpreadsheetSaveResult> {
  const requestId = requestedSaveIds.shift() ?? request.saveRequestId;
  const payload: SaveResultPayload = {
    requestId,
    saveRequestId: request.saveRequestId,
    workbookId: request.workbookId,
    epoch: request.epoch,
    dirtyEpoch: request.dirtyEpoch,
    changeSequence: request.changeSequence,
    bytes: bytesToNumberArray(request.bytes),
    bytesHash: request.bytesHash,
    baseVersionId: request.baseVersionId,
  };
  post({ type: 'save-result', ...payload });

  return new Promise<SpreadsheetSaveResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingHostSaves.delete(requestId);
      reject(new Error('Timed out waiting for VS Code save acknowledgement'));
    }, 60000);
    pendingHostSaves.set(requestId, { request, resolve, reject, timeout });
  });
}

async function postHostExportRequest(request: SpreadsheetExportRequest): Promise<void> {
  if (!request.bytes) return;
  post({
    type: 'export-result',
    requestId: request.bytesHash ?? `export:${Date.now().toString(36)}`,
    bytes: bytesToNumberArray(request.bytes),
    bytesHash: request.bytesHash,
  });
}

async function initialize(message: Extract<ExtensionToWebview, { type: 'init' }>): Promise<void> {
  const generation = ++initGeneration;
  setRootState('loading');
  renderFallback('Opening workbook...');

  try {
    await disposeCurrent();
    if (generation !== initGeneration) return;

    activeColorScheme = message.colorScheme;
    const nextRuntime = await createSpreadsheetRuntime(runtimeOptions(message.assets));
    const nextWorkbook = await nextRuntime.openWorkbook({
      workbookId: message.documentId,
      workbookSessionId: message.documentId,
      displayName: message.fileName,
      source: {
        kind: 'xlsx-bytes',
        bytes: numberArrayToBytes(message.bytes),
        fileName: message.fileName,
        versionId: message.documentId,
      },
    });
    await nextWorkbook.whenReady();
    if (generation !== initGeneration) {
      await nextRuntime.dispose();
      return;
    }

    runtime = nextRuntime;
    workbook = nextWorkbook;
    unsubscribeDirty = nextWorkbook.onDirtyChange((state) => post(dirtyPayload(state)));

    root.innerHTML = '';
    attachment = mountSpreadsheetApp(root, {
      runtime: nextRuntime,
      workbook: nextWorkbook,
      workspace: {
        mode: 'single-document',
        fileExplorer: false,
        appSwitcher: false,
        settings: true,
      },
      chrome: {
        commandBar: true,
        fileMenu: false,
        formulaBar: true,
        sheetTabs: true,
        statusBar: true,
      },
      commands: {
        save: 'host',
        open: 'host',
        export: 'host',
        import: 'host',
        print: 'disabled',
        share: 'disabled',
      },
      theme: {
        uiChrome: {
          colorScheme: activeColorScheme,
        },
      },
      editModel: {
        user: 'write',
        agents: 'none',
        automation: 'none',
      },
      loadingFallback: 'Opening workbook...',
      onError: (error) => postError('mount', error),
    });
    await attachment.ready;
    setRootState('ready');
    markReadyForTests();
    post({ type: 'initialized', documentId: message.documentId });
  } catch (error) {
    setRootState('error');
    renderError(error);
    postError('init', error);
  }
}

async function handleRequestSave(requestId: string): Promise<void> {
  if (!workbook) {
    postError('request-save', new Error('Workbook is not ready'), requestId);
    return;
  }
  requestedSaveIds.push(requestId);
  try {
    const result = await workbook.requestSave();
    if (result.status !== 'saved') {
      postError('request-save', result.error, requestId);
    }
  } catch (error) {
    const index = requestedSaveIds.indexOf(requestId);
    if (index >= 0) requestedSaveIds.splice(index, 1);
    postError('request-save', error, requestId);
  }
}

async function handleRequestBackup(requestId: string): Promise<void> {
  if (!workbook) {
    postError('request-backup', new Error('Workbook is not ready'), requestId);
    return;
  }
  try {
    const bytes = await workbook.exportXlsx();
    post({ type: 'backup-result', requestId, bytes: bytesToNumberArray(bytes) });
  } catch (error) {
    postError('request-backup', error, requestId);
  }
}

async function handleRequestExport(requestId: string): Promise<void> {
  if (!workbook) {
    postError('request-export-xlsx', new Error('Workbook is not ready'), requestId);
    return;
  }
  try {
    const bytes = await workbook.exportXlsx();
    post({ type: 'export-result', requestId, bytes: bytesToNumberArray(bytes) });
  } catch (error) {
    postError('request-export-xlsx', error, requestId);
  }
}

function handleSaveAck(message: Extract<ExtensionToWebview, { type: 'save-ack' }>): void {
  const pending = pendingHostSaves.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingHostSaves.delete(message.requestId);
  pending.resolve({
    status: 'saved',
    workbookId: pending.request.workbookId,
    epoch: pending.request.epoch,
    baseVersionId: pending.request.baseVersionId,
    dirtyEpoch: pending.request.dirtyEpoch,
    changeSequence: pending.request.changeSequence,
    saveRequestId: pending.request.saveRequestId,
    bytesHash: pending.request.bytesHash,
    versionId: message.versionId,
  });
}

function handleSaveFailed(message: Extract<ExtensionToWebview, { type: 'save-failed' }>): void {
  const pending = pendingHostSaves.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingHostSaves.delete(message.requestId);
  pending.reject(new Error(message.message));
}

function handleTheme(message: Extract<ExtensionToWebview, { type: 'set-theme' }>): void {
  activeColorScheme = message.colorScheme;
  document.documentElement.dataset.mogColorScheme = activeColorScheme;
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      void initialize(message);
      break;
    case 'request-save':
      void handleRequestSave(message.requestId);
      break;
    case 'request-backup':
      void handleRequestBackup(message.requestId);
      break;
    case 'request-export-xlsx':
      void handleRequestExport(message.requestId);
      break;
    case 'save-ack':
      handleSaveAck(message);
      break;
    case 'save-failed':
      handleSaveFailed(message);
      break;
    case 'set-theme':
      handleTheme(message);
      break;
    case 'dispose':
      void disposeCurrent();
      break;
  }
});

renderFallback('Starting Mog Spreadsheet...');
post({ type: 'ready' });
