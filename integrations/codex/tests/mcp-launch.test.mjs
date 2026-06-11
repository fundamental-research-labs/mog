import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const pluginRoot = resolve(repoRoot, 'plugins/mog');

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

test('bundled MCP server launches relative to the installed plugin root', async () => {
  const installRoot = await mkdtemp(join(tmpdir(), 'mog-codex-installed-plugin-'));
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
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.0' },
        },
      }),
    );
    child.stdin.write(frame({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
    child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));

    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error('Timed out waiting for MCP responses')),
        5000,
      );
      const interval = setInterval(() => {
        if (messages.length >= 2) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolvePromise();
        }
      }, 25);
    });

    assert.equal(messages[0].id, 1);
    assert.equal(messages[0].result.serverInfo.name, 'mog');
    assert.equal(messages[1].id, 2);
    assert.ok(messages[1].result.tools.some((tool) => tool.name === 'mog_browser_start'));
    assert.ok(messages[1].result.tools.some((tool) => tool.name === 'mog_export_xlsx'));
  } finally {
    child.kill();
    await rm(installRoot, { recursive: true, force: true });
  }
});
