# Full Spreadsheet App Embed

Use `@mog-sdk/spreadsheet-app` when a trusted same-origin host wants the real Mog spreadsheet application inside its own product. The host owns file storage, authentication, page chrome, and workbook lifetime. Mog owns the spreadsheet UI while it is attached.

For lower-level sheet/view embeds, use `@mog-sdk/embed`. Do not import `apps/spreadsheet`, `@mog/shell`, runtime internals, or `@mog-sdk/embed/full-app` from host code.

## Ownership Model

```text
SpreadsheetRuntime
  owns shared shell services, assets, host authority, callbacks
  -> SpreadsheetWorkbookSession
       owns one live workbook/kernel session
       remains usable while headless
       -> SpreadsheetAppAttachmentHandle
            owns one mounted full-app UI attachment
            detach() unmounts UI only
```

Detach is not dispose. Closing a tab should detach the UI attachment and keep the `SpreadsheetWorkbookSession` alive. Kernel teardown is explicit: call `workbook.dispose()` or `runtime.dispose()`.

## Quick Start

```tsx
import '@mog-sdk/spreadsheet-app/styles.css';
import {
  MogSpreadsheetApp,
  createSpreadsheetRuntime,
  type SpreadsheetRuntime,
  type SpreadsheetSaveRequest,
  type SpreadsheetSaveResult,
  type SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';
import { useEffect, useRef, useState } from 'react';

export function ShortcutSpreadsheetTab({
  fileId,
  fileName,
  versionId,
  bytes,
  saveBytes,
}: {
  fileId: string;
  fileName: string;
  versionId?: string;
  bytes: Uint8Array;
  saveBytes(input: { bytes: Uint8Array; baseVersionId?: string }): Promise<{ versionId: string }>;
}) {
  const runtimeRef = useRef<SpreadsheetRuntime | null>(null);
  const [runtime, setRuntime] = useState<SpreadsheetRuntime | null>(null);
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbookSession | null>(null);
  const [uiAttached, setUiAttached] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let ownedRuntime: SpreadsheetRuntime | null = null;
    let ownedWorkbook: SpreadsheetWorkbookSession | null = null;

    async function boot() {
      const created = await createSpreadsheetRuntime({
        assets: {
          wasmBaseUrl: '/mog/wasm/',
          workerUrl: '/mog/worker.js',
          staticBaseUrl: '/mog/assets/',
        },
        host: {
          persistenceMode: 'host-owned-ephemeral',
        },
        onSaveRequest: async (request: SpreadsheetSaveRequest): Promise<SpreadsheetSaveResult> => {
          const saved = await saveBytes({
            bytes: request.bytes,
            baseVersionId: request.baseVersionId,
          });
          return {
            status: 'saved',
            workbookId: request.workbookId,
            epoch: request.epoch,
            baseVersionId: request.baseVersionId,
            dirtyEpoch: request.dirtyEpoch,
            changeSequence: request.changeSequence,
            saveRequestId: request.saveRequestId,
            bytesHash: request.bytesHash,
            versionId: saved.versionId,
          };
        },
      });

      ownedRuntime = created;
      runtimeRef.current = created;
      await created.ready;

      const session = await created.openWorkbook({
        workbookId: fileId,
        displayName: fileName,
        source: {
          kind: 'xlsx-bytes',
          bytes,
          fileName,
          versionId,
        },
      });
      ownedWorkbook = session;
      await session.ready;

      if (cancelled) {
        await session.dispose();
        await created.dispose();
        return;
      }

      setRuntime(created);
      setWorkbook(session);
    }

    void boot();
    return () => {
      cancelled = true;
      void ownedWorkbook?.dispose();
      void ownedRuntime?.dispose();
    };
  }, [bytes, fileId, fileName, saveBytes, versionId]);

  if (!runtime || !workbook) return null;

  return uiAttached ? (
    <MogSpreadsheetApp
      runtime={runtime}
      workbook={workbook}
      workspace={{
        mode: 'single-document',
        fileExplorer: false,
        appSwitcher: false,
        settings: true,
      }}
      chrome={{
        fileMenu: false,
        commandBar: {
          mode: 'mog',
          tabs: ['home', 'insert', 'data', 'view'],
          hiddenGroups: ['charts'],
          disabledCommands: ['export', 'print'],
        },
        formulaBar: true,
        sheetTabs: true,
        statusBar: true,
      }}
      commands={{
        save: 'host',
        open: 'host',
        import: 'disabled',
        export: 'host',
        print: 'disabled',
      }}
      onReady={(attachment) => {
        void attachment.ready;
      }}
    />
  ) : (
    <button type="button" onClick={() => setUiAttached(true)}>
      Reattach UI
    </button>
  );
}
```

For tabbed hosts, create one runtime at the host-app level, then call `runtime.openWorkbook(...)` once per spreadsheet tab. Render `MogSpreadsheetApp` only for the active tab. Inactive tabs should keep their `SpreadsheetWorkbookSession` objects and no hidden app DOM.

## Detach And Dispose

Use attachment detach for UI lifecycle:

```ts
const attachment = mountSpreadsheetApp(container, { runtime, workbook });
await attachment.ready;

await attachment.detach();
await workbook.getWorkbook().activeSheet.setCell('B1', 456);

const secondAttachment = mountSpreadsheetApp(container, { runtime, workbook });
await secondAttachment.ready;
await secondAttachment.detach();
```

Use workbook/runtime dispose for kernel lifecycle:

```ts
await workbook.dispose();
await runtime.dispose();
```

Disposed workbook, actor, view, and attachment handles should reject with typed lifecycle errors. Reopening a workbook with the same public `workbookId` must create a fresh internal session; do not depend on `workbookId` as the compute instance identity.

## Programmatic Access

`SpreadsheetWorkbookSession.getWorkbook()` returns a capability-routed facade over the public Workbook API and works while the UI is detached.

```ts
const api = workbook.getWorkbook();
await api.activeSheet.setCell('A1', 123);
const cell = await api.activeSheet.getCell('A1');
```

Agent or automation code should use `resolveActor(...)` when host authority is enabled:

```ts
const actor = await workbook.resolveActor({
  actorId: 'shortcut-agent',
  kind: 'agent',
  displayName: 'Shortcut Agent',
});

await actor.undoGroup('Agent write', async () => {
  await actor.getWorkbook().activeSheet.setCell('C1', '=A1*2');
});
```

## Save Contract

`exportXlsx()` is side-effect-free byte export.

`requestSave()` creates a save request, calls the runtime `onSaveRequest`, and transitions clean only when the save acknowledgement matches the request tuple:

- `workbookId`
- `epoch`
- `dirtyEpoch`
- `changeSequence`
- `saveRequestId`
- `bytesHash`

Shortcut should persist `request.bytes`, then return `status: 'saved'` with the same tuple and the new `versionId`. Failed saves should return `status: 'failed'`; Mog keeps the workbook dirty.

## Runtime Assets

Set `assets` when the host serves Mog worker, WASM, fonts, or static assets from non-root paths:

```ts
const runtime = await createSpreadsheetRuntime({
  assets: {
    wasmBaseUrl: '/mog/wasm/',
    workerUrl: '/mog/worker.js',
    staticBaseUrl: '/mog/assets/',
  },
  host: { persistenceMode: 'host-owned-ephemeral' },
});
```

If the host uses the bundled Vite path in this monorepo, the workspace plugin resolves WASM and font assets. Packed-host distribution still needs a dedicated smoke gate before public release.

## Verification

Behavior gates:

```bash
pnpm --filter @mog-sdk/spreadsheet-app test
```

Also run repo-wide `pnpm typecheck` for TypeScript changes; the wider baseline is expected to stay green.
