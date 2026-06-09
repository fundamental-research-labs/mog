import * as assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import * as vscode from 'vscode';

type ReadyState = {
  readonly uri: string;
  readonly dirty: boolean;
  readonly version: number;
  readonly changeSequence: number;
};

type CdpTarget = {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
  readonly webSocketDebuggerUrl?: string;
};

type CdpResponse = {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
};

type CdpClient = {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
};

const extensionId = 'FundamentalResearchLabs.mog-xlsx-editor';

async function openFixtureCopy(name: string, destinationName = name): Promise<vscode.Uri> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, 'extension should be registered in VS Code host');
  await extension.activate();
  const workspace = process.env.MOG_VSCODE_TEST_WORKSPACE;
  assert.ok(workspace, 'MOG_VSCODE_TEST_WORKSPACE should be provided by the e2e runner');
  const source = path.join(extension.extensionPath, 'fixtures', name);
  const destination = path.join(workspace, destinationName);
  await copyFile(source, destination);
  const uri = vscode.Uri.file(destination);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'mog.xlsxEditor');
  return uri;
}

export async function run(): Promise<void> {
  await runSaveReopenScenario();
  await runKeyboardSaveScenario();
  await runRevertScenario();
  await runBackupScenario();
}

async function runSaveReopenScenario(): Promise<void> {
  const uri = await openFixtureCopy('edit-save-reopen.xlsx', 'edit-save-reopen-save.xlsx');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab, 'fixture tab should be active');
  const ready = await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForReady',
    uri.toString(),
    60000,
  );
  assert.equal(ready.uri, uri.toString());
  assert.equal(ready.dirty, false);

  const target = await findMogWebviewTarget();
  const cdp = await connectCdpTarget(target);
  try {
    await waitForWebviewReady(cdp);
    await waitForCanvasReady(cdp);
    await waitForFormulaBarValue(cdp, 'before');
    await editFormulaBar(cdp, 'after');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      true,
      60000,
    );
    await waitForActiveTabDirty(true);
    await clickWebviewSelector(cdp, '[aria-label="Save"]');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      false,
      60000,
    );
    await waitForActiveTabDirty(false);
  } finally {
    cdp.close();
  }

  await assertWorkbookCell(uri.fsPath, 'Sheet1', 'A1', 'after');

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('vscode.openWith', uri, 'mog.xlsxEditor');
  await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForReady',
    uri.toString(),
    60000,
  );
  const reopenedTarget = await findMogWebviewTarget();
  const reopenedCdp = await connectCdpTarget(reopenedTarget);
  try {
    await waitForWebviewReady(reopenedCdp);
    await waitForCanvasReady(reopenedCdp);
    await waitForFormulaBarValue(reopenedCdp, 'after');
  } finally {
    reopenedCdp.close();
  }
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

async function runKeyboardSaveScenario(): Promise<void> {
  const uri = await openFixtureCopy('edit-save-reopen.xlsx', 'edit-save-reopen-keyboard-save.xlsx');
  await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForReady',
    uri.toString(),
    60000,
  );
  const cdp = await connectCdpTarget(await findMogWebviewTarget());
  try {
    await waitForWebviewReady(cdp);
    await waitForCanvasReady(cdp);
    await waitForFormulaBarValue(cdp, 'before');
    await editFormulaBar(cdp, 'keyboard-after');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      true,
      60000,
    );
    await waitForActiveTabDirty(true);
    await pressSaveShortcut(cdp);
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      false,
      60000,
    );
    await waitForActiveTabDirty(false);
  } finally {
    cdp.close();
  }

  await assertWorkbookCell(uri.fsPath, 'Sheet1', 'A1', 'keyboard-after');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

async function runRevertScenario(): Promise<void> {
  const uri = await openFixtureCopy('edit-save-reopen.xlsx', 'edit-save-reopen-revert.xlsx');
  await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForReady',
    uri.toString(),
    60000,
  );
  const cdp = await connectCdpTarget(await findMogWebviewTarget());
  try {
    await waitForWebviewReady(cdp);
    await waitForCanvasReady(cdp);
    await waitForFormulaBarValue(cdp, 'before');
    await editFormulaBar(cdp, 'discarded');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      true,
      60000,
    );
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      false,
      60000,
    );
    await waitForFormulaBarValue(cdp, 'before');
  } finally {
    cdp.close();
  }
  await assertWorkbookCell(uri.fsPath, 'Sheet1', 'A1', 'before');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

async function runBackupScenario(): Promise<void> {
  const uri = await openFixtureCopy('edit-save-reopen.xlsx', 'edit-save-reopen-backup.xlsx');
  await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForReady',
    uri.toString(),
    60000,
  );
  const cdp = await connectCdpTarget(await findMogWebviewTarget());
  try {
    await waitForWebviewReady(cdp);
    await waitForCanvasReady(cdp);
    await waitForFormulaBarValue(cdp, 'before');
    await editFormulaBar(cdp, 'backup-value');
    await vscode.commands.executeCommand<ReadyState>(
      'mog.xlsxEditor.test.waitForDirty',
      uri.toString(),
      true,
      60000,
    );
  } finally {
    cdp.close();
  }

  const workspace = process.env.MOG_VSCODE_TEST_WORKSPACE;
  assert.ok(workspace, 'MOG_VSCODE_TEST_WORKSPACE should be provided by the e2e runner');
  const backupDir = path.join(workspace, '.backups');
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, 'edit-save-reopen-backup.xlsx');
  const backup = await vscode.commands.executeCommand<ReadyState & { readonly backupId: string }>(
    'mog.xlsxEditor.test.writeBackup',
    uri.toString(),
    backupPath,
  );
  assert.equal(backup.uri, uri.toString());
  assert.equal(backup.dirty, true);
  assert.equal(backup.backupId, vscode.Uri.file(backupPath).toString());
  await assertWorkbookCell(backupPath, 'Sheet1', 'A1', 'backup-value');
  await assertWorkbookCell(uri.fsPath, 'Sheet1', 'A1', 'before');

  await vscode.commands.executeCommand('workbench.action.files.revert');
  await vscode.commands.executeCommand<ReadyState>(
    'mog.xlsxEditor.test.waitForDirty',
    uri.toString(),
    false,
    60000,
  );
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

function cdpBaseUrl(): string {
  const port = process.env.MOG_VSCODE_CDP_PORT;
  assert.ok(port, 'MOG_VSCODE_CDP_PORT should be provided by the e2e runner');
  return `http://127.0.0.1:${port}`;
}

async function findMogWebviewTarget(): Promise<CdpTarget> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const target of await listCdpTargets()) {
      if (
        target.type === 'iframe' &&
        target.url?.startsWith('vscode-webview://') &&
        target.url.includes(`extensionId=${extensionId}`) &&
        target.webSocketDebuggerUrl
      ) {
        return target;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Could not find Mog Spreadsheet webview CDP target.\nTargets:\n${formatTargets(await listCdpTargets())}`,
  );
}

async function waitForWebviewReady(cdp: CdpClient): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await evaluateInWebview<boolean | string | null>(
      cdp,
      `${webviewDocumentExpression()}.querySelector('#root')?.getAttribute('data-mog-ready') ?? null`,
    );
    if (ready === 'true') return;
    const state = await evaluateInWebview<string | null>(
      cdp,
      `${webviewDocumentExpression()}.querySelector('#root')?.getAttribute('data-mog-vscode-state') ?? null`,
    );
    if (state === 'error') {
      const text = await evaluateInWebview<string>(
        cdp,
        `${webviewDocumentExpression()}.querySelector('#root')?.textContent ?? ''`,
      );
      throw new Error(`Mog webview entered error state: ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const state = await evaluateInWebview<string | null>(
    cdp,
    `${webviewDocumentExpression()}.querySelector('#root')?.getAttribute('data-mog-vscode-state') ?? null`,
  );
  const snapshot = await evaluateInWebview<string>(
    cdp,
    `(${webviewDocumentExpression()}.documentElement?.outerHTML ?? document.documentElement.outerHTML).slice(0, 3000)`,
  );
  throw new Error(
    `Timed out waiting for Mog webview ready state; current state=${state}\nSnapshot:\n${snapshot}`,
  );
}

async function waitForCanvasReady(cdp: CdpClient): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const canvas = await evaluateInWebview<{ width: number; height: number } | null>(
      cdp,
      `(() => {
        const doc = ${webviewDocumentExpression()};
        const canvases = Array.from(doc.querySelectorAll('canvas'));
        const visible = canvases
          .map((canvas) => {
            const rect = canvas.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
          .filter((rect) => rect.width >= 100 && rect.height >= 100)
          .sort((a, b) => (b.width * b.height) - (a.width * a.height));
        return visible[0] ?? null;
      })()`,
    );
    if (canvas) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for a visible Mog grid canvas');
}

function webviewDocumentExpression(): string {
  return `(document.getElementById('active-frame')?.contentDocument ?? document)`;
}

async function waitForFormulaBarValue(cdp: CdpClient, expected: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const actual = await getFormulaBarValue(cdp);
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Expected formula bar value ${JSON.stringify(expected)}, got ${JSON.stringify(
      await getFormulaBarValue(cdp),
    )}`,
  );
}

async function waitForActiveTabDirty(expected: boolean, timeoutMs = 60000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.isDirty === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.equal(
    activeTab?.isDirty,
    expected,
    `Expected active VS Code tab dirty=${expected}, got ${String(activeTab?.isDirty)}`,
  );
}

async function getFormulaBarValue(cdp: CdpClient): Promise<string | null> {
  return evaluateInWebview<string | null>(
    cdp,
    `${webviewDocumentExpression()}.querySelector('[data-testid="formula-bar-input"]')?.value ?? null`,
  );
}

async function editFormulaBar(cdp: CdpClient, value: string): Promise<void> {
  await clickWebviewSelector(cdp, '[data-testid="formula-bar-input"]');
  await selectFormulaBarText(cdp);
  await cdp.send('Input.insertText', { text: value });
  await pressKey(cdp, 'Enter', 'Enter', 13);
}

async function selectFormulaBarText(cdp: CdpClient): Promise<void> {
  const selected = await evaluateInWebview<boolean>(
    cdp,
    `(() => {
      const input = ${webviewDocumentExpression()}.querySelector('[data-testid="formula-bar-input"]');
      if (!input || typeof input.focus !== 'function' || typeof input.select !== 'function') return false;
      input.focus();
      input.select();
      return true;
    })()`,
  );
  assert.equal(selected, true, 'formula bar input should be selectable');
}

async function clickWebviewSelector(cdp: CdpClient, selector: string): Promise<void> {
  const point = await evaluateInWebview<{ x: number; y: number } | null>(
    cdp,
    `(() => {
      const frame = document.getElementById('active-frame');
      const doc = frame?.contentDocument ?? document;
      const el = doc.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const frameRect = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: frameRect.left + rect.left + rect.width / 2, y: frameRect.top + rect.top + rect.height / 2 };
    })()`,
  );
  assert.ok(point, `Could not find webview selector: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function pressKey(
  cdp: CdpClient,
  key: string,
  code: string,
  windowsVirtualKeyCode: number,
): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
}

async function pressSaveShortcut(cdp: CdpClient): Promise<void> {
  const isMac = process.platform === 'darwin';
  const modifier = isMac
    ? { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: 4 }
    : { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 };

  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: modifier.key,
    code: modifier.code,
    windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
    nativeVirtualKeyCode: modifier.windowsVirtualKeyCode,
    modifiers: modifier.modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
    modifiers: modifier.modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
    modifiers: modifier.modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: modifier.key,
    code: modifier.code,
    windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
    nativeVirtualKeyCode: modifier.windowsVirtualKeyCode,
  });
}

async function assertWorkbookCell(
  filePath: string,
  sheetName: string,
  address: string,
  expected: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(sheetName);
  assert.ok(worksheet, `Expected worksheet ${sheetName}`);
  assert.equal(worksheet.getCell(address).value, expected);
}

async function evaluateInWebview<T>(cdp: CdpClient, expression: string): Promise<T> {
  const result = await cdp.send<{
    result?: { value?: T };
    exceptionDetails?: { text?: string };
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? `CDP evaluation failed: ${expression}`);
  }
  return result.result?.value as T;
}

async function listCdpTargets(): Promise<CdpTarget[]> {
  const response = await fetch(`${cdpBaseUrl()}/json/list`);
  return (await response.json()) as CdpTarget[];
}

function formatTargets(targets: readonly CdpTarget[]): string {
  return targets
    .map((target) => `${target.type ?? '<unknown>'}: ${target.title ?? ''} ${target.url ?? ''}`)
    .join('\n');
}

async function connectCdpTarget(target: CdpTarget): Promise<CdpClient> {
  assert.ok(target.webSocketDebuggerUrl, `CDP target has no websocket URL: ${target.url}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error(`Could not connect to CDP target: ${target.url}`)),
      { once: true },
    );
  });

  socket.addEventListener('message', (event) => {
    const response = JSON.parse(String(event.data)) as CdpResponse;
    if (typeof response.id !== 'number') return;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.error) {
      entry.reject(new Error(response.error.message ?? 'CDP command failed'));
    } else {
      entry.resolve(response.result);
    }
  });

  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      entry.reject(new Error('CDP target socket closed'));
    }
    pending.clear();
  });

  const client: CdpClient = {
    send(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
  await client.send('Runtime.enable');
  return client;
}
