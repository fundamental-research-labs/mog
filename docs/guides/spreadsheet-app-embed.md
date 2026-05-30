# Full Spreadsheet App Embed

> **Status: shipped public package:** `@mog-sdk/spreadsheet-app`

Use `@mog-sdk/spreadsheet-app` when a trusted same-origin browser host wants the
full Mog spreadsheet application inside its own product. The host owns
authentication, authorization, page chrome, file storage, and the decision to
open or dispose workbook sessions. Mog owns the runtime-managed workbook
session and the spreadsheet UI while it is attached.

For lower-level read-only sheet/view embeds, use `@mog-sdk/embed`. Do not import
`@mog/app-spreadsheet`, `@mog/shell`, `@mog-sdk/kernel`, runtime internals, or
private full-app paths from host code.

This is a same-page React embed. It is not an iframe isolation boundary for
hostile workbook content or untrusted same-process code.

## Install

For a Vite React app:

```bash
npm create vite@latest mog-spreadsheet-app -- --template react-ts
cd mog-spreadsheet-app
npm install
npm install @mog-sdk/spreadsheet-app
```

`@mog-sdk/spreadsheet-app` has React and React DOM peer dependencies of React 19.
The browser runtime loads `@mog-sdk/wasm` through the installed package graph, so
use a browser bundler that supports ESM and wasm-pack-style `.wasm` assets. Vite
satisfies that path.

Prefer the scoped host CSS export:

```ts
import '@mog-sdk/spreadsheet-app/mog-embed.css';
```

The package also exports `@mog-sdk/spreadsheet-app/styles.css`, but that file is
the unscoped app stylesheet. Host products should use `mog-embed.css` unless
they intentionally want the app stylesheet to affect the whole page.

## Quick Start

Replace `src/App.tsx` with:

```tsx
import '@mog-sdk/spreadsheet-app/mog-embed.css';
import {
  MogSpreadsheetApp,
  createSpreadsheetRuntime,
  type SpreadsheetAppAttachmentHandle,
  type SpreadsheetRuntime,
  type SpreadsheetSaveRequest,
  type SpreadsheetSaveResult,
  type SpreadsheetWorkbookSession,
} from '@mog-sdk/spreadsheet-app';
import { useEffect, useRef, useState } from 'react';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadXlsx(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function savedResult(
  request: SpreadsheetSaveRequest,
  versionId: string,
): SpreadsheetSaveResult {
  return {
    status: 'saved',
    workbookId: request.workbookId,
    epoch: request.epoch,
    baseVersionId: request.baseVersionId,
    dirtyEpoch: request.dirtyEpoch,
    changeSequence: request.changeSequence,
    saveRequestId: request.saveRequestId,
    bytesHash: request.bytesHash,
    versionId,
  };
}

export default function App() {
  const attachmentRef = useRef<SpreadsheetAppAttachmentHandle | null>(null);
  const [runtime, setRuntime] = useState<SpreadsheetRuntime | null>(null);
  const [workbook, setWorkbook] = useState<SpreadsheetWorkbookSession | null>(null);
  const [uiAttached, setUiAttached] = useState(true);
  const [lastSavedVersion, setLastSavedVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ownedRuntime: SpreadsheetRuntime | null = null;
    let ownedWorkbook: SpreadsheetWorkbookSession | null = null;

    async function boot() {
      const created = await createSpreadsheetRuntime({
        host: {
          persistenceMode: 'host-owned-ephemeral',
          beforeUnloadPrompt: false,
        },
        onSaveRequest: async (request) => {
          const versionId = `browser-download-${Date.now()}`;

          downloadXlsx(request.bytes, 'mog-workbook.xlsx');
          setLastSavedVersion(versionId);

          return savedResult(request, versionId);
        },
      });

      ownedRuntime = created;
      await created.ready;

      const session = await created.openWorkbook({
        workbookId: 'demo-workbook',
        displayName: 'Demo Workbook',
        source: { kind: 'blank' },
      });
      ownedWorkbook = session;
      await session.ready;

      const api = session.getWorkbook();
      await api.activeSheet.setCell('A1', 'Hello from Mog');
      await api.activeSheet.setCell('B1', '=1+1');

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
      attachmentRef.current = null;
      void ownedWorkbook?.dispose();
      void ownedRuntime?.dispose();
    };
  }, []);

  if (!runtime || !workbook) {
    return <main style={{ padding: 24 }}>Loading Mog...</main>;
  }

  const detachUi = () => {
    const attachment = attachmentRef.current;
    if (!attachment) {
      setUiAttached(false);
      return;
    }

    void attachment.detach().finally(() => {
      attachmentRef.current = null;
      setUiAttached(false);
    });
  };

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        height: '100vh',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          borderBottom: '1px solid #d0d7de',
          display: 'flex',
          gap: 8,
          padding: 12,
        }}
      >
        <button type="button" onClick={() => void workbook.requestSave()}>
          Save XLSX
        </button>
        <button type="button" disabled={!uiAttached} onClick={detachUi}>
          Detach UI
        </button>
        <button type="button" disabled={uiAttached} onClick={() => setUiAttached(true)}>
          Reattach UI
        </button>
        <span>{lastSavedVersion ?? workbook.getAttachmentState().status}</span>
      </div>

      <section style={{ minHeight: 0 }}>
        {uiAttached ? (
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
                disabledCommands: ['print'],
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
              attachmentRef.current = attachment;
            }}
            onDisposed={() => {
              attachmentRef.current = null;
            }}
          />
        ) : (
          <div style={{ padding: 24 }}>
            UI detached. The workbook session is still open and can be saved or
            edited through the host API.
          </div>
        )}
      </section>
    </main>
  );
}
```

Then run:

```bash
npm run dev
```

This example opens a blank workbook and uses the host-owned save callback to
download XLSX bytes. Production hosts should replace `downloadXlsx(...)` with
their own persistence flow and should validate workbook identity and user
authorization before returning a saved `versionId`.

To open existing bytes instead of a blank workbook, resolve the bytes in trusted
host code and pass them to `openWorkbook`:

```ts
const session = await runtime.openWorkbook({
  workbookId: fileId,
  displayName: fileName,
  source: {
    kind: 'xlsx-bytes',
    bytes,
    fileName,
    versionId,
  },
});
```

## Ownership Model

```text
SpreadsheetRuntime
  owns shared shell services, host policy, callbacks
  -> SpreadsheetWorkbookSession
       owns one live workbook/kernel session
       remains usable while headless
       -> SpreadsheetAppAttachmentHandle
            owns one mounted full-app UI attachment
            detach() unmounts UI only
```

Detach is not dispose. Unmounting `MogSpreadsheetApp` or calling
`SpreadsheetAppAttachmentHandle.detach()` removes the UI attachment and returns
the workbook session to `headless`. The workbook facade remains usable until
you call `workbook.dispose()`, `runtime.disposeWorkbook(...)`, or
`runtime.dispose()`.

Only one full-app UI attachment may be active for a `SpreadsheetWorkbookSession`
at a time. For tabbed hosts, create one `SpreadsheetRuntime` at the host-app
level, call `runtime.openWorkbook(...)` once per spreadsheet tab, and render
`MogSpreadsheetApp` only for the active tab. Inactive tabs should keep their
`SpreadsheetWorkbookSession` objects and no hidden app DOM.

`workbookId` is a semantic public identity. Use the generated or host-supplied
`workbookSessionId` when you need to address an exact open session. Multiple
open sessions may share the same `workbookId`, and
`getWorkbookSessionByWorkbookId(...)` returns `null` when that lookup is
ambiguous.

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

Disposed workbook, actor, view, and attachment handles throw or reject with
public lifecycle errors such as `Disposed`, `StaleEpoch`, `AlreadyAttached`,
`AttachFailed`, and `DetachFailed`.

## Programmatic Access

`SpreadsheetWorkbookSession.getWorkbook()` returns a capability-routed facade
over the public Workbook API and works while the UI is detached.

```ts
const api = workbook.getWorkbook();
await api.activeSheet.setCell('A1', 123);
const cell = await api.activeSheet.getCell('A1');
```

If you do not configure `host.authority`, omit the actor for trusted-host
operations or use ordinary user actors. Explicit `host`, `agent`, `automation`,
and `system` actor refs require a host authority adapter.

Agent or automation code should use `resolveActor(...)` when host authority is
enabled:

```ts
const actor = await workbook.resolveActor({
  actorId: 'host-agent',
  kind: 'agent',
  displayName: 'Host Agent',
});

await actor.undoGroup('Agent write', async () => {
  await actor.getWorkbook().activeSheet.setCell('C1', '=A1*2');
});
```

## Save Contract

`exportXlsx()` is side-effect-free byte export.

`requestSave()` creates a save request, calls the runtime `onSaveRequest`, and
transitions clean only when the save acknowledgement matches the pending save
for the workbook session:

- `epoch`
- `dirtyEpoch`
- `changeSequence`
- `saveRequestId`
- `bytesHash`

The host should persist `request.bytes`, then return `status: 'saved'` with
those fields echoed, plus the public `workbookId` and the new `versionId`.
Failed saves should return `status: 'failed'` with a `SpreadsheetAppError`; Mog
keeps the workbook dirty.

The File menu and app chrome commands route through `commands`,
`onSaveRequest`, and `onCommandRequest`. In `host-owned-ephemeral` mode, command
ownership defaults to the host. Use `commands` to explicitly assign `save`,
`open`, `import`, `export`, `print`, and `share` to `'host'`, `'mog'`, or
`'disabled'`.

## Runtime Assets

Most bundled React hosts should omit `assets`. The current browser transport
loads `@mog-sdk/wasm` with a dynamic import, and Vite serves the wasm-pack
artifact from the installed package.

The runtime still accepts an asset policy for hosts that need to pass explicit
runtime URLs into the shell host adapter:

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

Do not assume `@mog-sdk/spreadsheet-app` publishes a standalone public
`worker.js` file to copy. Its package `dist` currently contains
`compute_core_wasm_bg.wasm`, `styles.css`, `mog-embed.css`, and bundled Carlito
and Caladea font files under `assets/`. If you serve the CSS yourself instead
of importing it through the bundler, keep those font assets available at paths
that match the CSS URL references.

## Verification

For changes to this package, use the smallest relevant check. Package behavior
gates include:

```bash
pnpm --filter @mog-sdk/spreadsheet-app test
```

Also run repo-wide `pnpm typecheck` when TypeScript changes affect shared public
contracts or runtime declarations.
