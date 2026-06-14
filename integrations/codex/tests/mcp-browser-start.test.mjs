import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const pluginRoot = resolve(repoRoot, 'plugins/mog');
const wasmPackageJson = JSON.parse(
  await readFile(resolve(repoRoot, 'compute/wasm/npm/package.json'), 'utf8'),
);
const expectedWasmBaseUrl = `https://cdn.jsdelivr.net/npm/@mog-sdk/wasm@${wasmPackageJson.version}/`;

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

function parseToolContent(message) {
  return JSON.parse(message.result.content[0].text);
}

test('mog_browser_start returns a live localhost browser host and bootstrap payload', async () => {
  const installRoot = await mkdtemp(join(tmpdir(), 'mog-codex-browser-plugin-'));
  const installedPluginRoot = join(installRoot, 'mog');
  await cp(pluginRoot, installedPluginRoot, { recursive: true });
  const child = spawn('node', ['./dist/mcp/server.mjs', '--stdio'], {
    cwd: installedPluginRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const messages = [];
    readFrames(child.stdout, (message) => messages.push(message));

    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    );
    child.stdin.write(frame({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'mog_browser_start', arguments: {} },
      }),
    );

    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error('Timed out waiting for mog_browser_start')),
        5000,
      );
      const interval = setInterval(() => {
        if (messages.some((message) => message.id === 2)) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolvePromise();
        }
      }, 25);
    });

    const startMessage = messages.find((message) => message.id === 2);
    const start = parseToolContent(startMessage);
    assert.match(start.browserUrl, /^http:\/\/127\.0\.0\.1:\d+\/sessions\/mog-/);

    const pageResponse = await fetch(start.browserUrl);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Mog Spreadsheet/);

    const pageUrl = new URL(start.browserUrl);
    const bootstrapUrl = new URL(
      `/api${pageUrl.pathname}/bootstrap${pageUrl.search}`,
      pageUrl.origin,
    );
    const bootstrapResponse = await fetch(bootstrapUrl);
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrap.sessionId, start.sessionId);
    assert.equal(bootstrap.source.kind, 'blank');
    assert.equal(bootstrap.wasmBaseUrl, expectedWasmBaseUrl);

    const importMapResponse = await fetch(new URL('/assets/import-map.json', pageUrl.origin));
    assert.equal(importMapResponse.status, 200);
    const importMap = await importMapResponse.json();
    assert.equal(importMap.imports['@mog-sdk/wasm'], `${expectedWasmBaseUrl}compute_core_wasm.js`);
  } finally {
    child.kill();
    await rm(installRoot, { recursive: true, force: true });
  }
});
