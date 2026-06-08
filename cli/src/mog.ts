#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, createWorkbook, Utils, type Workbook } from '@mog-sdk/sdk/node';
import {
  isNamedPipePath,
  parseCliArgs,
  pidPathForState,
  socketPathForState,
  stateKeyForCwd,
  toJsonSafe,
  usage,
  type DaemonRequest,
  type DaemonResponse,
} from './protocol';

type WorkbookEntry = {
  id: string;
  path: string;
  workbook: Workbook;
  loadedAt: string;
};

const workbooks = new Map<string, WorkbookEntry>();

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv.slice(2));

  if (command.kind === 'help') {
    console.log(usage());
    return;
  }

  if (command.kind === 'daemon') {
    await runDaemon(command.stateKey);
    return;
  }

  const stateKey = stateKeyForCwd();
  const request = await commandToRequest(command);
  const response = await sendWithAutoStart(stateKey, request);
  if (!response.ok) {
    console.error(JSON.stringify(response, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(response.result, null, 2));
}

async function commandToRequest(
  command: Exclude<ReturnType<typeof parseCliArgs>, { kind: 'help' | 'daemon' }>,
): Promise<DaemonRequest> {
  switch (command.kind) {
    case 'create':
      return {
        method: 'create',
        path: command.path,
        ...(command.name ? { name: command.name } : {}),
      };
    case 'load':
      return { method: 'load', path: command.path };
    case 'execute': {
      const code = command.codeFile
        ? await readFile(resolve(command.codeFile), 'utf8')
        : command.code;
      if (!code) {
        throw new Error('Usage: mog execute --id <workbookId> --code <code>');
      }
      return { method: 'execute', id: command.id, code };
    }
    case 'commit':
      return {
        method: 'commit',
        id: command.id,
        ...(command.path ? { path: resolve(command.path) } : {}),
      };
    case 'unload':
      return { method: 'unload', id: command.id };
    case 'list':
      return { method: 'list' };
    case 'shutdown':
      return { method: 'shutdown' };
  }
}

async function sendWithAutoStart(
  stateKey: string,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  try {
    return await sendRequest(stateKey, request);
  } catch {
    await startDaemon(stateKey);
    await waitForDaemon(stateKey);
    return sendRequest(stateKey, request);
  }
}

async function startDaemon(stateKey: string): Promise<void> {
  const cliPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [cliPath, '_daemon', stateKey], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

async function waitForDaemon(stateKey: string): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 5000) {
    try {
      await sendRequest(stateKey, { method: 'ping' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(`Mog daemon did not start: ${String(lastError)}`);
}

function sendRequest(stateKey: string, request: DaemonRequest): Promise<DaemonResponse> {
  const socketPath = socketPathForState(stateKey);
  return new Promise((resolveRequest, rejectRequest) => {
    const client = net.createConnection(socketPath);
    let data = '';
    client.setEncoding('utf8');
    client.setTimeout(5000);
    client.on('connect', () => {
      client.end(JSON.stringify(request));
    });
    client.on('data', (chunk) => {
      data += chunk;
    });
    client.on('end', () => {
      try {
        resolveRequest(JSON.parse(data) as DaemonResponse);
      } catch (error) {
        rejectRequest(error);
      }
    });
    client.on('timeout', () => {
      client.destroy(new Error('Timed out waiting for Mog daemon response.'));
    });
    client.on('error', rejectRequest);
  });
}

async function runDaemon(stateKey: string): Promise<void> {
  const socketPath = socketPathForState(stateKey);
  const pidPath = pidPathForState(stateKey);
  if (!isNamedPipePath(socketPath)) {
    await mkdir(dirname(socketPath), { recursive: true });
  }
  await mkdir(dirname(pidPath), { recursive: true });

  if (!isNamedPipePath(socketPath) && existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => {
      void handleRawRequest(data, server, { socketPath, pidPath }).then((response) => {
        socket.end(JSON.stringify(response));
      });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, () => {
      server.off('error', rejectListen);
      writeFileSync(pidPath, String(process.pid));
      resolveListen();
    });
  });

  const cleanup = async () => {
    await disposeAllWorkbooks();
    await cleanupStateFiles(socketPath, pidPath);
  };

  process.once('SIGTERM', () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(0));
  });
}

async function handleRawRequest(
  raw: string,
  server: net.Server,
  stateFiles: { socketPath: string; pidPath: string },
): Promise<DaemonResponse> {
  try {
    const request = JSON.parse(raw) as DaemonRequest;
    return { ok: true, result: await handleRequest(request, server, stateFiles) };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
}

async function handleRequest(
  request: DaemonRequest,
  server: net.Server,
  stateFiles: { socketPath: string; pidPath: string },
): Promise<unknown> {
  switch (request.method) {
    case 'ping':
      return { status: 'ok', handles: workbooks.size };
    case 'create': {
      if (existsSync(request.path)) {
        throw new Error(`Workbook already exists: ${request.path}`);
      }
      await mkdir(dirname(request.path), { recursive: true });
      const workbook = request.name
        ? await createWorkbook({ documentId: request.name })
        : await createWorkbook();
      await workbook.save(request.path);
      const id = randomUUID();
      const entry = { id, path: request.path, workbook, loadedAt: new Date().toISOString() };
      workbooks.set(id, entry);
      return describeEntry(entry);
    }
    case 'load': {
      await stat(request.path);
      const workbook = await createWorkbook(request.path);
      const id = randomUUID();
      const entry = { id, path: request.path, workbook, loadedAt: new Date().toISOString() };
      workbooks.set(id, entry);
      return describeEntry(entry);
    }
    case 'execute': {
      const entry = requireWorkbook(request.id);
      const logs: string[] = [];
      const scopedConsole = makeScopedConsole(logs);
      const AsyncFunction = Object.getPrototypeOf(async function () {
        // TypeScript target helper.
      }).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
      const fn = new AsyncFunction(
        'wb',
        'workbook',
        'ws',
        'activeSheet',
        'api',
        'Utils',
        'console',
        `"use strict";\n${request.code}`,
      );
      const result = await fn(
        entry.workbook,
        entry.workbook,
        entry.workbook.activeSheet,
        entry.workbook.activeSheet,
        api,
        Utils,
        scopedConsole,
      );
      return { result: toJsonSafe(result), logs };
    }
    case 'commit': {
      const entry = requireWorkbook(request.id);
      const path = request.path ?? entry.path;
      const bytes = await entry.workbook.save(path);
      return { id: entry.id, path, bytes: bytes.byteLength };
    }
    case 'unload': {
      const entry = requireWorkbook(request.id);
      await Promise.resolve(entry.workbook.dispose());
      workbooks.delete(entry.id);
      return { id: entry.id, unloaded: true };
    }
    case 'list':
      return [...workbooks.values()].map(describeEntry);
    case 'shutdown':
      await disposeAllWorkbooks();
      server.close(() => {
        void cleanupStateFiles(stateFiles.socketPath, stateFiles.pidPath);
      });
      return { shutdown: true };
  }
}

async function disposeAllWorkbooks(): Promise<void> {
  for (const entry of workbooks.values()) {
    await Promise.resolve(entry.workbook.dispose());
  }
  workbooks.clear();
}

async function cleanupStateFiles(socketPath: string, pidPath: string): Promise<void> {
  if (!isNamedPipePath(socketPath)) {
    await unlink(socketPath).catch(() => undefined);
  }
  await unlink(pidPath).catch(() => undefined);
}

function requireWorkbook(id: string): WorkbookEntry {
  const entry = workbooks.get(id);
  if (!entry) throw new Error(`Unknown workbook id: ${id}`);
  return entry;
}

function describeEntry(entry: WorkbookEntry): object {
  return {
    id: entry.id,
    path: entry.path,
    loadedAt: entry.loadedAt,
  };
}

function makeScopedConsole(logs: string[]): Pick<Console, 'log' | 'warn' | 'error' | 'info'> {
  const push = (level: string, args: unknown[]) => {
    logs.push(`[${level}] ${args.map(formatLogArg).join(' ')}`);
  };
  return {
    log: (...args: unknown[]) => push('log', args),
    info: (...args: unknown[]) => push('info', args),
    warn: (...args: unknown[]) => push('warn', args),
    error: (...args: unknown[]) => push('error', args),
  };
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(toJsonSafe(arg));
  } catch {
    return String(arg);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
