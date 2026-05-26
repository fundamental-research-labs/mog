/**
 * Debug lifecycle — run directly with tsx to bypass Jest.
 *
 *   cd sdk && npx tsx examples/debug-lifecycle.ts
 */

// Suppress known harmless errors
process.on('uncaughtException', (err) => {
  if (err.message?.includes('Bridge is disposed')) return;
  if (err.message?.includes('indexedDB')) return;
  console.error('[uncaught]', err.message);
});
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message?.includes('Bridge is disposed')) return;
  if (reason?.message?.includes('indexedDB')) return;
  console.error('[rejection]', reason?.message ?? reason);
});

async function main() {
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[${Date.now() - t0}ms] ${msg}`);

  log('importing createWorkbook...');
  const { createWorkbook } = await import('../src/index');

  log('calling createWorkbook()...');
  const wb = await createWorkbook();
  log('workbook created');

  const ws = wb.activeSheet;
  await ws.setCell('A1', 42);
  const val = await ws.getValue('A1');
  log(`A1 = ${val}`);

  log('calling wb.dispose()...');
  await wb.dispose();
  log('dispose returned');

  // Check what's keeping the process alive
  log('checking active handles...');
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const requests = (process as any)._getActiveRequests?.() ?? [];
  log(`active handles: ${handles.length}, active requests: ${requests.length}`);
  for (const h of handles) {
    const type = h.constructor?.name ?? typeof h;
    const ref = h.hasRef?.() ?? 'unknown';
    log(`  handle: ${type} (ref=${ref})`);
  }

  log('setting 5s timeout to monitor CPU...');
  const cpuStart = process.cpuUsage();
  setTimeout(() => {
    const cpuEnd = process.cpuUsage(cpuStart);
    log(`CPU usage over 5s: user=${cpuEnd.user / 1000}ms, system=${cpuEnd.system / 1000}ms`);
    log('forcing exit');
    process.exit(0);
  }, 5000);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
