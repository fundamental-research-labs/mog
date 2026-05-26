import {
  MogSpreadsheetApp,
  createSpreadsheetRuntime,
  mountSpreadsheetApp,
  type MogSpreadsheetAppProps,
  type SpreadsheetAppAttachmentHandle,
  type SpreadsheetRuntime,
  type SpreadsheetRuntimeOptions,
  type SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';

const runtimeOptions: SpreadsheetRuntimeOptions = {
  assets: {
    wasmBaseUrl: '/mog/wasm/',
    workerUrl: '/mog/worker.js',
    staticBaseUrl: '/mog/assets/',
  },
  host: {
    persistenceMode: 'host-owned-ephemeral',
  },
};

async function exerciseRuntimeOwnedLifecycle(container: HTMLElement): Promise<void> {
  const runtime: SpreadsheetRuntime = await createSpreadsheetRuntime(runtimeOptions);
  const workbook: SpreadsheetWorkbookSession = await runtime.openWorkbook({
    workbookId: 'shortcut-tab-a',
    displayName: 'Shortcut Tab A',
    source: { kind: 'blank' },
  });

  const props: MogSpreadsheetAppProps = {
    runtime,
    workbook,
    workspace: {
      mode: 'single-document',
      fileExplorer: false,
      appSwitcher: false,
      settings: true,
    },
    chrome: {
      fileMenu: false,
      formulaBar: true,
      sheetTabs: true,
    },
  };

  void (
    <MogSpreadsheetApp
      {...props}
      onReady={(handle: SpreadsheetAppAttachmentHandle) => {
        handle.focus();
      }}
    />
  );

  const attachment = mountSpreadsheetApp(container, props);
  await attachment.ready;
  await attachment.detach();

  const detachedWorkbook = workbook.getWorkbook();
  await detachedWorkbook.activeSheet.setCell('B1', 456);
  const detachedValue = await detachedWorkbook.activeSheet.getValue('B1');
  void detachedValue;

  await workbook.undoGroup(
    { actorId: 'shortcut-host', kind: 'host', displayName: 'Shortcut Host' },
    'Detached host write',
    async () => {
      await workbook.getWorkbook().activeSheet.setCell('B2', '=B1*2');
    },
  );

  const secondAttachment = mountSpreadsheetApp(container, props);
  await secondAttachment.ready;
  await secondAttachment.detach();

  await workbook.dispose();
  await runtime.dispose();
}

void exerciseRuntimeOwnedLifecycle;

console.log('PASS: @mog-sdk/spreadsheet-app runtime-owned lifecycle type fixture');
