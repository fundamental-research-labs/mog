import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorkbook } from '@mog-sdk/sdk/node';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const cliPath = resolve(repoRoot, 'cli', 'dist', 'mog.cjs');
const nativeAddon = resolve(repoRoot, 'compute', 'napi', 'compute-core-napi.node');
const platformAddon = resolve(
  repoRoot,
  'compute',
  'napi',
  'npm',
  currentPlatformPackageDir(),
  'compute-core-napi.node',
);

if (!existsSync(cliPath)) {
  throw new Error(`Built CLI not found: ${cliPath}. Run pnpm --filter @mog-sdk/cli build first.`);
}

let temporaryPlatformAddon = false;
if (!existsSync(platformAddon) && existsSync(nativeAddon)) {
  mkdirSync(resolve(platformAddon, '..'), { recursive: true });
  symlinkSync('../../compute-core-napi.node', platformAddon);
  temporaryPlatformAddon = true;
}

const root = mkdtempSync(join(tmpdir(), 'mog-cli-e2e-'));
const socketPath =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\mog-cli-e2e-${process.pid}-${Date.now()}`
    : join(root, 'daemon.sock');
const pidPath = join(root, 'daemon.pid');
const cliEnv = {
  ...process.env,
  MOG_CLI_SOCKET: socketPath,
  MOG_CLI_PID: pidPath,
};
const workbooks = join(root, 'workbooks');
const exactWorkbookPath = join(root, 'exact-create.xlsx');
const committedCopyPath = join(root, 'committed-copy.xlsx');
const loadedWorkbookPath = join(root, 'loaded.xlsx');
const createdWorkbookName = 'created-by-cli';
const createdWorkbookPath = join(workbooks, `${createdWorkbookName}.xlsx`);
mkdirSync(workbooks, { recursive: true });

if (process.platform !== 'win32') {
  writeFileSync(socketPath, 'stale socket placeholder');
}
writeFileSync(pidPath, '999999');

function run(args, options = {}) {
  const stdout = execFileSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? root,
    env: cliEnv,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function runRaw(args, options = {}) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? root,
    env: cliEnv,
    encoding: 'utf8',
  });
}

function runFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? root,
    env: cliEnv,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`Expected command to fail: mog ${args.join(' ')}\n${result.stdout}`);
  }
  return JSON.parse(result.stderr);
}

let loadedId;
let createdId;
let exactId;

try {
  const help = runRaw(['--help']);
  if (!help.includes('mog create <path>') || !help.includes('mog execute --id')) {
    throw new Error(`help output does not describe core commands:\n${help}`);
  }

  const exact = run(['create', exactWorkbookPath]);
  exactId = exact.id;
  if (!exactId) throw new Error(`create <path> did not return an id: ${JSON.stringify(exact)}`);
  if (exact.path !== exactWorkbookPath) {
    throw new Error(`create <path> wrote ${exact.path}, expected ${exactWorkbookPath}`);
  }
  if (readFileSync(pidPath, 'utf8') === '999999') {
    throw new Error('daemon did not replace the stale pid file');
  }
  if (process.platform !== 'win32' && !existsSync(socketPath)) {
    throw new Error(`daemon socket was not created at override path ${socketPath}`);
  }

  const listedAfterCreate = run(['list']);
  if (
    !listedAfterCreate.some((entry) => entry.id === exactId && entry.path === exactWorkbookPath)
  ) {
    throw new Error(`list did not include created workbook: ${JSON.stringify(listedAfterCreate)}`);
  }

  const codeFile = join(root, 'edit-exact.js');
  writeFileSync(
    codeFile,
    [
      'console.log("from code-file", { ok: true });',
      'await ws.setCell("C1", "file edit");',
      'return await ws.getValue("C1");',
    ].join('\n'),
  );
  const codeFileResult = run(['execute', '--id', exactId, '--code-file', codeFile]);
  if (codeFileResult.result !== 'file edit') {
    throw new Error(`code-file execute failed: ${JSON.stringify(codeFileResult)}`);
  }
  if (!codeFileResult.logs?.some((line) => line.includes('from code-file'))) {
    throw new Error(`captured console logs missing: ${JSON.stringify(codeFileResult)}`);
  }

  const failed = runFailure([
    'execute',
    '--id',
    exactId,
    '--code',
    'await ws.setCell("D1", "before throw"); console.warn("before failure"); throw new Error("planned failure");',
  ]);
  if (failed.ok !== false || !failed.error?.message?.includes('planned failure')) {
    throw new Error(`structured error was not returned: ${JSON.stringify(failed)}`);
  }
  const retainedMutation = run([
    'execute',
    '--id',
    exactId,
    '--code',
    'return await ws.getValue("D1");',
  ]);
  if (retainedMutation.result !== 'before throw') {
    throw new Error(
      `non-transactional mutation was not retained: ${JSON.stringify(retainedMutation)}`,
    );
  }

  const committedCopy = run(['commit', '--id', exactId, '--path', committedCopyPath]);
  if (committedCopy.path !== committedCopyPath || committedCopy.bytes <= 0) {
    throw new Error(`commit --path failed: ${JSON.stringify(committedCopy)}`);
  }
  const exactUnloaded = run(['unload', '--id', exactId]);
  exactId = undefined;
  if (exactUnloaded.unloaded !== true) {
    throw new Error(`unload exact failed: ${JSON.stringify(exactUnloaded)}`);
  }

  const reopenedCopy = await createWorkbook(committedCopyPath);
  const copiedFileValue = await reopenedCopy.activeSheet.getValue('C1');
  const copiedRetainedValue = await reopenedCopy.activeSheet.getValue('D1');
  await reopenedCopy.dispose();
  if (copiedFileValue !== 'file edit' || copiedRetainedValue !== 'before throw') {
    throw new Error(`committed copy values were C1=${copiedFileValue}, D1=${copiedRetainedValue}`);
  }

  const created = run(['create', '--name', createdWorkbookName, '--path', workbooks]);
  createdId = created.id;
  if (!createdId) throw new Error(`create --name did not return an id: ${JSON.stringify(created)}`);
  if (created.path !== createdWorkbookPath) {
    throw new Error(`create --name path was ${created.path}, expected ${createdWorkbookPath}`);
  }
  const createExecuted = run([
    'execute',
    '--id',
    createdId,
    '--code',
    'await ws.setCell("B1", "created"); return await ws.getValue("B1");',
  ]);
  if (createExecuted.result !== 'created') {
    throw new Error(`created workbook execute failed: ${JSON.stringify(createExecuted)}`);
  }
  run(['commit', '--id', createdId]);
  run(['unload', '--id', createdId]);
  createdId = undefined;

  const reopenedCreated = await createWorkbook(createdWorkbookPath);
  const createdValue = await reopenedCreated.activeSheet.getValue('B1');
  await reopenedCreated.dispose();
  if (createdValue !== 'created') {
    throw new Error(`created workbook B1 was ${createdValue}, expected "created"`);
  }

  const wb = await createWorkbook();
  await wb.activeSheet.setCell('A1', 10);
  await wb.save(loadedWorkbookPath);
  await wb.dispose();

  const loaded = run(['load', loadedWorkbookPath]);
  loadedId = loaded.id;
  if (!loadedId) throw new Error(`load did not return an id: ${JSON.stringify(loaded)}`);

  const executed = run([
    'execute',
    '--id',
    loadedId,
    '--code',
    'console.info("doubling", await ws.getValue("A1")); await ws.setCell("A2", "=A1*2"); return await ws.getValue("A2");',
  ]);
  if (executed.result !== 20 || !executed.logs?.some((line) => line.includes('doubling 10'))) {
    throw new Error(`execute returned ${JSON.stringify(executed)}, expected result 20 and log`);
  }

  const committed = run(['commit', '--id', loadedId]);
  if (committed.bytes <= 0) {
    throw new Error(`commit did not report saved bytes: ${JSON.stringify(committed)}`);
  }

  const unloaded = run(['unload', '--id', loadedId]);
  loadedId = undefined;
  if (unloaded.unloaded !== true) {
    throw new Error(`unload failed: ${JSON.stringify(unloaded)}`);
  }

  const reopened = await createWorkbook(loadedWorkbookPath);
  const value = await reopened.activeSheet.getValue('A2');
  await reopened.dispose();
  if (value !== 20) throw new Error(`reopened A2 was ${value}, expected 20`);

  const listedAfterUnload = run(['list']);
  if (listedAfterUnload.length !== 0) {
    throw new Error(`list retained unloaded handles: ${JSON.stringify(listedAfterUnload)}`);
  }

  run(['shutdown']);
  await waitForDaemonStateCleanup();

  console.log(
    JSON.stringify(
      {
        ok: true,
        loadedWorkbookPath,
        createdWorkbookPath,
        committedCopyPath,
        value,
        createdValue,
        copiedFileValue,
        copiedRetainedValue,
      },
      null,
      2,
    ),
  );
} finally {
  for (const id of [exactId, createdId, loadedId].filter(Boolean)) {
    try {
      run(['unload', '--id', id]);
    } catch {
      // Best-effort cleanup.
    }
  }
  try {
    run(['shutdown']);
  } catch {
    // Best-effort cleanup.
  }
  rmSync(root, { recursive: true, force: true });
  if (temporaryPlatformAddon) rmSync(platformAddon, { force: true });
}

async function waitForDaemonStateCleanup() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const socketGone = process.platform === 'win32' || !existsSync(socketPath);
    const pidGone = !existsSync(pidPath);
    if (socketGone && pidGone) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`daemon state files were not cleaned up: socket=${socketPath} pid=${pidPath}`);
}

function currentPlatformPackageDir() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(`Unsupported platform for Mog CLI E2E: ${process.platform}/${process.arch}`);
}
