import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
import type { SpreadsheetRuntime, SpreadsheetRuntimeOptions } from '../public-types';

function runtimeOptions(runtimeId: string): SpreadsheetRuntimeOptions {
  return {
    runtimeId,
    host: {
      persistenceMode: 'host-owned-ephemeral',
      authority: {
        resolveActor(ref) {
          return {
            actorId: ref.actorId,
            kind: ref.kind ?? 'host',
            displayName: ref.displayName,
          };
        },
        authorize() {
          return { decision: 'allowed', policyVersion: 'chart-export-test' };
        },
      },
    },
  };
}

async function disposeRuntime(runtime: SpreadsheetRuntime | undefined): Promise<void> {
  if (!runtime) return;
  await runtime.dispose();
}

test('spreadsheet runtime exportXlsx preserves created charts through the production exporter', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-chart-xlsx-export'));
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-chart-xlsx-source',
      source: { kind: 'blank' },
    });
    await workbook.ready;

    const facade = workbook.getWorkbook();
    const sheet = facade.activeSheet;
    await sheet.setCell('A1', 'Month');
    await sheet.setCell('B1', 'Revenue');
    await sheet.setCell('A2', 'Jan');
    await sheet.setCell('B2', 12);
    await sheet.setCell('A3', 'Feb');
    await sheet.setCell('B3', 28);
    await sheet.setCell('A4', 'Mar');
    await sheet.setCell('B4', 19);

    await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 8,
      height: 12,
      dataRange: 'A1:B4',
      title: 'Quarter Revenue',
    });

    const exported = await workbook.exportXlsx({ actorId: 'test-host', kind: 'host' });
    assert.ok(exported instanceof Uint8Array);
    assert.ok(exported.byteLength > 0);

    const imported = await runtime.openWorkbook({
      workbookId: 'runtime-chart-xlsx-imported',
      source: { kind: 'xlsx-bytes', bytes: exported },
    });
    await imported.ready;

    const importedCharts = await imported.getWorkbook().activeSheet.charts.list();
    assert.equal(importedCharts.length, 1);
    assert.equal(importedCharts[0]?.type, 'bar');
    assert.equal(importedCharts[0]?.title, 'Quarter Revenue');
    assert.ok(importedCharts[0]?.dataRange);
  } finally {
    await disposeRuntime(runtime);
  }
});
