# Embed: React

> **Status: public-experimental**

Embed a Mog spreadsheet in React with `MogSheet` from `@mog-sdk/embed/react`.
The React subpath is shipped, but it is not yet a stable long-term API
contract.

`MogSheet` is a same-page browser embed. It does not accept raw `src` URLs,
inline bytes, provider config, or storage credentials as public props. Pass an
opaque source ref in `config`, then resolve authorized XLSX bytes through a
trusted host-owned `hostPolicy`.

## Install

For a Vite React app:

```bash
npm create vite@latest mog-react-embed -- --template react-ts
cd mog-react-embed
npm install
npm install @mog-sdk/embed
```

`@mog-sdk/embed/react` has React and React DOM peer dependencies of React 18 or
newer. The Vite React template already installs them. Existing apps should have
`react` and `react-dom` installed alongside `@mog-sdk/embed`.

The browser runtime loads `@mog-sdk/wasm`. Use a browser bundler that supports
ES modules and wasm-pack-style `.wasm` assets; Vite satisfies that path. For
this local example, place any valid workbook at `public/sample.xlsx`.

## Render a Sheet

Replace `src/App.tsx` with:

```tsx
import { useMemo } from 'react';
import {
  MogSheet,
  type MogEmbedConfig,
  type MogEmbedEffectiveState,
  type MogEmbedHostPolicy,
} from '@mog-sdk/embed/react';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sourceByRef = new Map<string, string>([
  ['sample-workbook', '/sample.xlsx'],
]);

async function loadAuthorizedXlsxBytes(sourceRef: string): Promise<Uint8Array> {
  const url = sourceByRef.get(sourceRef);
  if (!url) throw new Error('Unknown Mog source ref');

  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to load workbook: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export default function App() {
  const config = useMemo<MogEmbedConfig>(
    () => ({
      source: { kind: 'document', ref: 'sample-workbook' },
      requestedMode: 'readonly',
      requestedCapabilities: ['view', 'export'],
      requestedSavePolicy: 'export-only',
      chrome: {
        formulaBar: true,
        sheetTabs: true,
        headers: true,
        gridlines: true,
        scrollbars: true,
        zoomControls: true,
      },
    }),
    [],
  );

  const hostPolicy = useMemo<MogEmbedHostPolicy>(
    () => ({
      async resolveSource(config) {
        return {
          bytes: await loadAuthorizedXlsxBytes(config.source.ref),
          authorizationRef: `demo-authz:${config.source.ref}`,
          contentType: XLSX_MIME,
        };
      },
      resolveEffectiveState(): MogEmbedEffectiveState {
        return {
          mode: 'readonly',
          capabilities: ['view', 'export'],
          deniedCapabilities: [],
          savePolicy: 'export-only',
          collaboration: 'none',
          dirty: false,
          saveState: 'idle',
        };
      },
      async requestExport(format) {
        if (format !== 'xlsx') return null;
        const bytes = await loadAuthorizedXlsxBytes('sample-workbook');
        return new Blob([bytes], { type: XLSX_MIME });
      },
    }),
    [],
  );

  return (
    <main style={{ padding: 24 }}>
      <MogSheet
        config={config}
        hostPolicy={hostPolicy}
        width={1000}
        height={600}
      />
    </main>
  );
}
```

Then run:

```bash
npm run dev
```

This example uses a static same-origin file only to make the host resolver
small. Production hosts should validate the opaque source ref against the
current user/session before returning bytes. Do not put URLs, paths, bearer
tokens, provider config, storage credentials, or raw workbook bytes in
`MogEmbedConfig`.

Keep `config` and `hostPolicy` object identities stable unless you want the
embed to reload; the React component recreates the same-page host when those
props change.

## Host Policy Contract

`resolveSource(config)` is required. It must return host-authorized XLSX bytes
as `Uint8Array` or `ArrayBuffer`.

`resolveEffectiveState(config)` is required. Caller fields such as
`requestedMode`, `requestedCapabilities`, `requestedSavePolicy`, and
`requestedCollaboration` are requests only. The effective mode, capabilities,
save policy, collaboration mode, dirty flag, and save state come from the host
policy and are surfaced through callbacks and the component handle.

`requestSave(state)` and `requestExport(format, state)` are optional host-owned
callbacks. Callback presence alone is never a grant. Save requires the
effective `save` capability plus `host-callback` or `autosave`; live
collaboration only allows `autosave`. Export requires the effective `export`
capability and a non-`none` save policy.

The save/export callbacks receive effective state, not direct workbook,
worksheet, provider, or kernel objects. If a host needs server-side persistence
or export, keep that association in the host session or closure.

## Component Handle

Use a React ref when the host needs imperative operations:

```tsx
import { useRef } from 'react';
import { MogSheet, type MogSheetHandle } from '@mog-sdk/embed/react';

const sheetRef = useRef<MogSheetHandle>(null);

sheetRef.current?.navigateToRange('B2:D10');
const state = sheetRef.current?.getEffectiveState();
```

The public handle exposes status, sheet navigation, dirty-state read/mark-clean,
save/export requests, effective state, range navigation, resize, focus, and
disposal. It does not expose workbook, worksheet, provider, renderer, or kernel
objects.

## Security Notes

React embeds run in the host page's JavaScript context and origin. They are not
an isolation boundary for hostile workbook content. Use a separate isolation
strategy for untrusted content; the iframe embed protocol is reserved and is not
exported from `@mog-sdk/embed`.
