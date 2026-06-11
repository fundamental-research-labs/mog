import {
  createSpreadsheetRuntime,
  mountSpreadsheetApp,
  type SpreadsheetAppAttachmentHandle,
  type SpreadsheetRuntime,
  type SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';

import {
  base64ToBytes,
  bytesToBase64,
  jsonSafe,
  type BrowserBootstrap,
  type BrowserRpcRequest,
} from '../shared/protocol';

const root = requireRoot();

let runtime: SpreadsheetRuntime | null = null;
let workbook: SpreadsheetWorkbookSession | null = null;
let attachment: SpreadsheetAppAttachmentHandle | null = null;
let eventSource: EventSource | null = null;
let bootstrap: BrowserBootstrap | null = null;

function requireRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) {
    throw new Error('Mog browser host root is missing');
  }
  return element;
}

function sessionIdFromPath(): string {
  const match = /^\/sessions\/([^/]+)$/.exec(window.location.pathname);
  if (!match) throw new Error('Mog session id is missing from URL');
  return decodeURIComponent(match[1]);
}

function tokenFromUrl(): string {
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) throw new Error('Mog session token is missing from URL');
  return token;
}

function renderFallback(text: string): void {
  root.innerHTML = '';
  const fallback = document.createElement('div');
  fallback.className = 'mog-codex-fallback';
  fallback.textContent = text;
  root.appendChild(fallback);
}

function renderError(error: unknown): void {
  root.innerHTML = '';
  const node = document.createElement('pre');
  node.className = 'mog-codex-error';
  node.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  root.appendChild(node);
}

async function postJson(path: string, body: unknown): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function statusPayload(patch: Record<string, unknown> = {}): Record<string, unknown> {
  let activeSheetName: string | undefined;
  try {
    activeSheetName = attachment?.view().getActiveSheet().sheetName;
  } catch {
    activeSheetName = undefined;
  }
  return {
    connected: true,
    ready: Boolean(runtime && workbook && attachment),
    workbookId: workbook?.workbookId,
    workbookSessionId: workbook?.workbookSessionId,
    attachmentId: attachment?.attachmentId,
    activeSheetName,
    canvasCount: document.querySelectorAll('canvas').length,
    smokeStatus: runtime && workbook && attachment ? 'ready' : 'loading',
    ...patch,
  };
}

async function postStatus(patch: Record<string, unknown> = {}): Promise<void> {
  if (!bootstrap) return;
  await postJson(
    `/api/sessions/${encodeURIComponent(bootstrap.sessionId)}/status?token=${encodeURIComponent(bootstrap.token)}`,
    statusPayload(patch),
  );
}

async function fetchBootstrap(): Promise<BrowserBootstrap> {
  const sessionId = sessionIdFromPath();
  const token = tokenFromUrl();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/bootstrap?token=${encodeURIComponent(token)}`,
    { headers: { accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(`Could not load Mog browser session: HTTP ${response.status}`);
  }
  return (await response.json()) as BrowserBootstrap;
}

async function disposeCurrent(): Promise<void> {
  eventSource?.close();
  eventSource = null;
  const currentAttachment = attachment;
  const currentRuntime = runtime;
  attachment = null;
  workbook = null;
  runtime = null;
  try {
    await currentAttachment?.detach();
  } finally {
    await currentRuntime?.dispose();
  }
}

async function initializeWorkbook(config: BrowserBootstrap): Promise<void> {
  renderFallback('Opening workbook...');
  const assetBase = new URL(config.assetBaseUrl, window.location.origin).toString();
  const wasmBase = new URL(config.wasmBaseUrl, window.location.href).toString();
  const nextRuntime = await createSpreadsheetRuntime({
    assets: {
      wasmBaseUrl: wasmBase,
      workerUrl: new URL('worker.js', assetBase).toString(),
      fontBaseUrl: new URL('assets/', assetBase).toString(),
      staticBaseUrl: assetBase,
    },
    host: {
      persistenceMode: 'host-owned-ephemeral',
      beforeUnloadPrompt: false,
    },
    onSaveRequest: async (request) => ({
      status: 'saved',
      workbookId: request.workbookId,
      epoch: request.epoch,
      dirtyEpoch: request.dirtyEpoch,
      changeSequence: request.changeSequence,
      saveRequestId: request.saveRequestId,
      bytesHash: request.bytesHash,
      baseVersionId: request.baseVersionId,
      versionId: `codex:${Date.now().toString(36)}`,
    }),
    onCommandRequest: async (request) => {
      if (request.command === 'save') {
        return { status: 'handled', command: request.command };
      }
      if (request.command === 'export' && request.export?.format === 'xlsx') {
        return { status: 'handled', command: request.command };
      }
      return {
        status: 'denied',
        command: request.command,
        reason: 'The Mog Codex host owns file operations through explicit MCP tools.',
      };
    },
  });

  const source =
    config.source.kind === 'blank'
      ? { kind: 'blank' as const }
      : {
          kind: 'xlsx-bytes' as const,
          bytes: base64ToBytes(config.source.bytesBase64),
          fileName: config.source.fileName,
          versionId: config.source.versionId,
        };

  const nextWorkbook = await nextRuntime.openWorkbook({
    workbookId: config.sessionId,
    workbookSessionId: config.sessionId,
    displayName:
      config.source.kind === 'xlsx-bytes' ? config.source.fileName : 'Untitled Mog workbook',
    source,
  });
  await nextWorkbook.whenReady();

  runtime = nextRuntime;
  workbook = nextWorkbook;
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
    editModel: {
      user: 'write',
      agents: 'write',
      automation: 'write',
    },
    loadingFallback: 'Opening workbook...',
    onError: (error) => {
      void postStatus({
        ready: false,
        smokeStatus: 'error',
        error: error.message,
      });
    },
  });
  await attachment.ready;
  root.dataset.mogReady = 'true';
  await postStatus({ ready: true, smokeStatus: 'ready' });
}

async function getWorksheet(sheet?: string) {
  const current = workbook;
  if (!current) throw new Error('Workbook is not ready');
  const facade = current.getWorkbook();
  if (sheet) return facade.getSheet(sheet);
  return facade.activeSheet;
}

async function handleCellRead(request: Extract<BrowserRpcRequest, { type: 'cell_read' }>) {
  const ws = await getWorksheet(request.sheet);
  const target = request.range ?? request.address;
  if (!target) throw new Error('address or range is required');
  if (request.range || target.includes(':')) {
    return {
      sheet: ws.name,
      range: target,
      cells: jsonSafe(await ws.getRange(target)),
    };
  }
  return {
    sheet: ws.name,
    address: target,
    cell: jsonSafe(await ws.getCell(target)),
    value: jsonSafe(await ws.getValue(target)),
  };
}

async function handleCellWrite(request: Extract<BrowserRpcRequest, { type: 'cell_write' }>) {
  const ws = await getWorksheet(request.sheet);
  await ws.setCell(request.address, request.value as never);
  await workbook?.whenReady();
  await attachment?.view().select({ sheet: ws.name, range: request.address });
  await attachment?.view().scrollTo({ sheet: ws.name, range: request.address });
  await postStatus();
  return {
    sheet: ws.name,
    address: request.address,
    cell: jsonSafe(await ws.getCell(request.address)),
    value: jsonSafe(await ws.getValue(request.address)),
  };
}

async function handleSelectionSet(request: Extract<BrowserRpcRequest, { type: 'selection_set' }>) {
  if (!attachment) throw new Error('Spreadsheet app is not attached');
  await attachment.view().select({ sheet: request.sheet, range: request.range });
  await attachment.view().scrollTo({ sheet: request.sheet, range: request.range });
  await postStatus();
  return jsonSafe(attachment.view().getSelection());
}

async function handleExportXlsx() {
  if (!workbook) throw new Error('Workbook is not ready');
  const bytes = await workbook.exportXlsx();
  return {
    bytesBase64: bytesToBase64(bytes),
    bytes: bytes.byteLength,
  };
}

async function handleRpc(request: BrowserRpcRequest): Promise<unknown> {
  switch (request.type) {
    case 'cell_read':
      return handleCellRead(request);
    case 'cell_write':
      return handleCellWrite(request);
    case 'selection_set':
      return handleSelectionSet(request);
    case 'export_xlsx':
      return handleExportXlsx();
    case 'session_close':
      await disposeCurrent();
      return { closed: true };
    default:
      throw new Error(`Unknown browser RPC: ${(request as { type: string }).type}`);
  }
}

async function postRpcResult(requestId: string, body: unknown): Promise<void> {
  if (!bootstrap) return;
  await postJson(
    `/api/sessions/${encodeURIComponent(bootstrap.sessionId)}/rpc-result?token=${encodeURIComponent(bootstrap.token)}`,
    body,
  );
}

function connectEvents(config: BrowserBootstrap): void {
  eventSource?.close();
  eventSource = new EventSource(
    `/api/sessions/${encodeURIComponent(config.sessionId)}/events?token=${encodeURIComponent(config.token)}`,
  );
  eventSource.addEventListener('rpc', (event) => {
    const request = JSON.parse((event as MessageEvent<string>).data) as BrowserRpcRequest;
    void handleRpc(request)
      .then((result) =>
        postRpcResult(request.requestId, {
          requestId: request.requestId,
          ok: true,
          result: jsonSafe(result),
        }),
      )
      .catch((error) =>
        postRpcResult(request.requestId, {
          requestId: request.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
  });
  eventSource.addEventListener('close', () => {
    void disposeCurrent();
  });
}

async function main(): Promise<void> {
  try {
    renderFallback('Starting Mog...');
    bootstrap = await fetchBootstrap();
    await postStatus({ ready: false, smokeStatus: 'loading' });
    await initializeWorkbook(bootstrap);
    connectEvents(bootstrap);
  } catch (error) {
    renderError(error);
    await postStatus({
      ready: false,
      smokeStatus: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

window.addEventListener('beforeunload', () => {
  eventSource?.close();
});

void main();
