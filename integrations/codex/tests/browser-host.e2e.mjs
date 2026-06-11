import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const repoRoot = resolve(import.meta.dirname, '../../..');
const pluginRoot = resolve(repoRoot, 'plugins/mog');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`), body]);
}

function readFrames(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString('ascii');
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      assert.ok(match, `Missing Content-Length in ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.byteLength < bodyEnd) return;
      const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.slice(bodyEnd);
      onMessage(JSON.parse(body));
    }
  });
}

function waitForMessage(messages, id, timeoutMs = 30000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error(`Timed out waiting for MCP id ${id}`)),
      timeoutMs,
    );
    const interval = setInterval(() => {
      const match = messages.find((message) => message.id === id);
      if (match) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolvePromise(match);
      }
    }, 25);
  });
}

function parseToolContent(message) {
  assert.equal(message.result?.isError, undefined, message.result?.content?.[0]?.text);
  return JSON.parse(message.result.content[0].text);
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'mog-codex-e2e-'));
  const installedPluginRoot = join(tempDir, 'installed-plugin', 'mog');
  await cp(pluginRoot, installedPluginRoot, { recursive: true });
  const child = spawn('node', ['./dist/mcp/server.mjs', '--stdio'], {
    cwd: installedPluginRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let browser;
  const messages = [];
  readFrames(child.stdout, (message) => messages.push(message));
  child.stderr.pipe(process.stderr);

  try {
    let nextId = 1;
    const send = (method, params = {}) => {
      const id = nextId++;
      child.stdin.write(frame({ jsonrpc: '2.0', id, method, params }));
      return id;
    };
    send('initialize', { protocolVersion: '2024-11-05' });
    child.stdin.write(frame({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
    await waitForMessage(messages, 1);

    const startId = send('tools/call', { name: 'mog_browser_start', arguments: {} });
    const start = parseToolContent(await waitForMessage(messages, startId));

    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (error) => {
      throw error;
    });
    await page.goto(start.browserUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root[data-mog-ready="true"]', { timeout: 60000 });
    const canvasCount = await page.locator('canvas').count();
    assert.ok(canvasCount > 0, 'Expected the Mog grid to render canvases');

    const formulaInput = page.locator('[data-testid="formula-bar-input"]').first();
    await formulaInput.waitFor({ timeout: 30000 });
    await formulaInput.click();
    await formulaInput.fill('123');
    await page.keyboard.press('Enter');

    const readId = send('tools/call', {
      name: 'mog_cell_read',
      arguments: { sessionId: start.sessionId, address: 'A1' },
    });
    const read = parseToolContent(await waitForMessage(messages, readId));
    assert.equal(read.result.value, 123);

    const writeId = send('tools/call', {
      name: 'mog_cell_write',
      arguments: { sessionId: start.sessionId, address: 'B1', value: 'Codex' },
    });
    const write = parseToolContent(await waitForMessage(messages, writeId));
    assert.equal(write.result.value, 'Codex');

    const statusId = send('tools/call', {
      name: 'mog_browser_status',
      arguments: { sessionId: start.sessionId },
    });
    const status = parseToolContent(await waitForMessage(messages, statusId));
    assert.equal(status.status.ready, true);
    assert.ok(status.status.canvasCount > 0);

    const outputPath = join(tempDir, 'exported.xlsx');
    const exportId = send('tools/call', {
      name: 'mog_export_xlsx',
      arguments: { sessionId: start.sessionId, outputPath },
    });
    const exported = parseToolContent(await waitForMessage(messages, exportId, 60000));
    assert.equal(exported.outputPath, outputPath);
    assert.ok(exported.bytesWritten > 0);
    assert.equal((await readFile(outputPath)).subarray(0, 2).toString('utf8'), 'PK');

    const fixturePath = resolve(
      repoRoot,
      'integrations/vscode/mog-xlsx-editor/fixtures/simple-values.xlsx',
    );
    const importStartId = send('tools/call', {
      name: 'mog_browser_start',
      arguments: { xlsxPath: fixturePath },
    });
    const importedStart = parseToolContent(await waitForMessage(messages, importStartId));
    const importPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await importPage.goto(importedStart.browserUrl, { waitUntil: 'domcontentloaded' });
    await importPage.waitForSelector('#root[data-mog-ready="true"]', { timeout: 60000 });
    assert.ok((await importPage.locator('canvas').count()) > 0);

    const importedReadId = send('tools/call', {
      name: 'mog_cell_read',
      arguments: { sessionId: importedStart.sessionId, range: 'A1:C1' },
    });
    const importedRead = parseToolContent(await waitForMessage(messages, importedReadId));
    assert.equal(importedRead.result.cells[0][0].value, 'Mog');
    assert.equal(importedRead.result.cells[0][1].value, 42);
    assert.equal(importedRead.result.cells[0][2].value, 84);

    console.log('Mog Codex browser host E2E passed');
  } finally {
    await browser?.close().catch(() => {});
    child.kill();
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
