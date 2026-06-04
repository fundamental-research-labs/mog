import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorkbook } from '@mog-sdk/node';

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
  throw new Error(`Built CLI not found: ${cliPath}. Run pnpm --filter @mog/cli build first.`);
}

let temporaryPlatformAddon = false;
if (!existsSync(platformAddon) && existsSync(nativeAddon)) {
  symlinkSync('../../compute-core-napi.node', platformAddon);
  temporaryPlatformAddon = true;
}

const root = mkdtempSync(join(tmpdir(), 'mog-cli-e2e-'));
const workbookPath = join(root, 'book.xlsx');
const createdWorkbookName = 'created-by-cli';
const createdWorkbookPath = join(root, `${createdWorkbookName}.xlsx`);

function run(args) {
  const stdout = execFileSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

let id;

try {
  const created = run(['create', '--name', createdWorkbookName, '--path', root]);
  id = created.id;
  if (!id) throw new Error(`create did not return an id: ${JSON.stringify(created)}`);
  if (created.path !== createdWorkbookPath) {
    throw new Error(`create path was ${created.path}, expected ${createdWorkbookPath}`);
  }

  const createExecuted = run([
    'execute',
    '--id',
    id,
    '--code',
    'await ws.setCell("B1", "created"); return await ws.getValue("B1");',
  ]);
  if (createExecuted.result !== 'created') {
    throw new Error(`created workbook execute failed: ${JSON.stringify(createExecuted)}`);
  }
  run(['commit', '--id', id]);
  run(['unload', '--id', id]);
  id = undefined;

  const reopenedCreated = await createWorkbook(createdWorkbookPath);
  const createdValue = await reopenedCreated.activeSheet.getValue('B1');
  await reopenedCreated.dispose();
  if (createdValue !== 'created') {
    throw new Error(`created workbook B1 was ${createdValue}, expected "created"`);
  }

  const wb = await createWorkbook();
  await wb.activeSheet.setCell('A1', 10);
  await wb.save(workbookPath);
  await wb.dispose();

  const loaded = run(['load', workbookPath]);
  id = loaded.id;
  if (!id) throw new Error(`load did not return an id: ${JSON.stringify(loaded)}`);

  const executed = run([
    'execute',
    '--id',
    id,
    '--code',
    'await ws.setCell("A2", "=A1*2"); return await ws.getValue("A2");',
  ]);
  if (executed.result !== 20) {
    throw new Error(`execute returned ${JSON.stringify(executed)}, expected result 20`);
  }

  const committed = run(['commit', '--id', id]);
  if (committed.bytes <= 0) {
    throw new Error(`commit did not report saved bytes: ${JSON.stringify(committed)}`);
  }

  const unloaded = run(['unload', '--id', id]);
  id = undefined;
  if (unloaded.unloaded !== true) {
    throw new Error(`unload failed: ${JSON.stringify(unloaded)}`);
  }

  const reopened = await createWorkbook(workbookPath);
  const value = await reopened.activeSheet.getValue('A2');
  await reopened.dispose();
  if (value !== 20) throw new Error(`reopened A2 was ${value}, expected 20`);

  run(['shutdown']);
  console.log(
    JSON.stringify({ ok: true, workbookPath, createdWorkbookPath, value, createdValue }, null, 2),
  );
} finally {
  if (id) {
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

function currentPlatformPackageDir() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(`Unsupported platform for Mog CLI E2E: ${process.platform}/${process.arch}`);
}
