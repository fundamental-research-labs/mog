import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

const extensionDevelopmentPath = resolve(new URL('../..', import.meta.url).pathname);
const extensionTestsPath = resolve(extensionDevelopmentPath, 'dist/e2e/index.cjs');
const shortRoot = resolve(tmpdir(), `mog-xlsx-vscode-${process.pid}`);
const testWorkspace = resolve(shortRoot, 'workspace');
const userDataDir = resolve(shortRoot, 'user-data');
const extensionsDir = resolve(shortRoot, 'extensions');
const cdpPort = await getFreePort();
const vscodeExecutablePath = process.env.MOG_VSCODE_EXECUTABLE_PATH;

await Promise.all([
  mkdir(testWorkspace, { recursive: true }),
  mkdir(userDataDir, { recursive: true }),
  mkdir(extensionsDir, { recursive: true }),
]);

await runTests({
  ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
  extensionDevelopmentPath,
  extensionTestsPath,
  launchArgs: [
    testWorkspace,
    '--disable-extensions',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
  ],
  extensionTestsEnv: {
    MOG_VSCODE_CDP_PORT: String(cdpPort),
    MOG_VSCODE_TEST_WORKSPACE: testWorkspace,
  },
});

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a local CDP port')));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}
