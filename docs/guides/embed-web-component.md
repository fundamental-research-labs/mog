# Embed: Web Component

`@mog-sdk/embed` is a shipped public browser package. Its
`@mog-sdk/embed/web-component` entrypoint and `<mog-sheet>` custom element are
public-experimental.

Use the web component when a browser host wants a lower-level sheet/view embed
without React. Same-page embeds run in the host page's origin; they are not an
isolation boundary for hostile workbook content. Use
[`@mog-sdk/spreadsheet-app`](spreadsheet-app-embed.md) when you need the full
spreadsheet application.

## Install

This runnable path uses Vite so the browser ESM bundle and the `@mog-sdk/wasm`
dependency are served from npm packages.

```bash
npm create vite@latest mog-web-component -- --template vanilla
cd mog-web-component
npm install @mog-sdk/embed
```

## Add the Element

Replace `index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mog web component embed</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
      }

      main {
        box-sizing: border-box;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 12px;
        height: 100vh;
        padding: 16px;
      }

      .toolbar {
        align-items: center;
        display: flex;
        gap: 12px;
      }

      mog-sheet {
        border: 1px solid #d0d7de;
        height: 100%;
        min-height: 360px;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="toolbar">
        <label>
          XLSX file
          <input
            id="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
        </label>
        <span id="status">Choose an .xlsx file.</span>
      </div>

      <mog-sheet id="sheet"></mog-sheet>
    </main>

    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

Replace `src/main.js` with:

```js
import '@mog-sdk/embed/web-component';

await customElements.whenDefined('mog-sheet');

const fileInput = document.querySelector('#file');
const sheet = document.querySelector('#sheet');
const status = document.querySelector('#status');
const issuedFiles = new Map();

function issueSourceRef(file) {
  const ref =
    globalThis.crypto?.randomUUID?.() ?? `file-${Date.now()}-${Math.random().toString(16)}`;
  issuedFiles.set(ref, file);
  return ref;
}

function setStatus(message) {
  status.textContent = message;
}

sheet.hostPolicy = {
  async resolveSource(config) {
    const file = issuedFiles.get(config.source.ref);
    if (!file) {
      throw new Error('Unknown or expired source ref.');
    }

    return {
      bytes: await file.arrayBuffer(),
      authorizationRef: config.source.ref,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  },

  resolveEffectiveState() {
    return {
      mode: 'readonly',
      capabilities: ['view'],
      deniedCapabilities: ['edit', 'save', 'export'],
      savePolicy: 'none',
      collaboration: 'none',
      dirty: false,
      saveState: 'idle',
    };
  },
};

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  setStatus(`Loading ${file.name}...`);

  sheet.config = {
    source: { kind: 'file', ref: issueSourceRef(file) },
    requestedMode: 'readonly',
    requestedCapabilities: ['view'],
    requestedSavePolicy: 'none',
    requestedCollaboration: 'none',
  };
});

sheet.addEventListener('mog-ready', () => {
  setStatus('Loaded.');
});

sheet.addEventListener('mog-error', (event) => {
  const error = event.detail;
  console.error(error);
  setStatus(`Error: ${error?.message ?? String(error)}`);
});

sheet.addEventListener('mog-effective-state-change', (event) => {
  console.log('Mog effective state', event.detail);
});
```

Then start Vite:

```bash
npm run dev
```

Select an `.xlsx` file in the browser. The public element receives only an
opaque source ref in `sheet.config`; the trusted host policy resolves that ref
to authorized bytes before the embed client is created.

## Host Policy Contract

Public markup and public props must not pass raw workbook URLs, paths, bytes,
provider config, or storage credentials. The config validator rejects raw
`source.url` and `source.path` fields, and `<mog-sheet src="...">` is rejected
with a `mog-error` event.

Importing `@mog-sdk/embed` also registers `<mog-sheet>`; the
`@mog-sdk/embed/web-component` subpath is the narrower entrypoint for
web-component-only hosts.

`requestedMode`, `requestedCapabilities`, `requestedSavePolicy`, and
`requestedCollaboration` are requests, not grants. The host policy's
`resolveEffectiveState(config)` result is the effective state. `<mog-sheet>`
exposes it through `sheet.effectiveState`, `sheet.getEffectiveState()`, and
`mog-effective-state-change`.

The element also exposes `ready`, `status`, `setSheet(indexOrName)`,
`navigateToRange(range)`, `resize()`, `focus()`, `requestSave()`,
`requestExport(format)`, and `dispose()`.

## Save and Export

`requestSave()` and `requestExport()` are allowed only when effective state
grants the operation. Callback presence alone is never a grant: save requires
the effective `save` capability plus `host-callback` or `autosave`; live
collaboration only allows autosave. Export requires the effective `export`
capability and a non-`none` save policy.
