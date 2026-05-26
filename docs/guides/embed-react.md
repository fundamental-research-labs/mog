# Embed: React

Embed a Mog spreadsheet in React with `MogSheet` from `@mog-sdk/embed/react`.

Public React embeds do not accept raw bytes, URLs, provider config, or storage credentials. The component receives an opaque source ref and a trusted same-origin `hostPolicy`; the host policy resolves authorized bytes and effective state before the production embed client boots.

```tsx
import {
  MogSheet,
  type MogEmbedConfig,
  type MogEmbedEffectiveState,
  type MogEmbedHostPolicy,
} from '@mog-sdk/embed/react';

const config: MogEmbedConfig = {
  source: { kind: 'document', ref: 'issued-source-ref' },
  requestedMode: 'readonly',
  requestedCapabilities: ['view', 'export'],
  requestedSavePolicy: 'export-only',
};

const hostPolicy: MogEmbedHostPolicy = {
  async resolveSource(config) {
    return {
      bytes: await loadAuthorizedXlsxBytes(config.source.ref),
      authorizationRef: 'authz-ref',
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
  requestExport(format, state) {
    // Called only when effective state grants export and savePolicy is not none.
    return exportAuthorizedWorkbook(format, state);
  },
};

export function SheetEmbed() {
  return <MogSheet config={config} hostPolicy={hostPolicy} />;
}
```

`requestSave()` and `requestExport()` are gated by effective state, not by callback presence. Save requires the effective `save` capability plus `host-callback` or `autosave`; live collaboration only allows autosave. Export requires the effective `export` capability and a non-`none` save policy.

The ref handle exposes public embed operations only: status, sheet navigation, dirty state, save/export requests, effective state, range navigation, resize, focus, and disposal. It does not expose workbook, worksheet, provider, or kernel objects.
