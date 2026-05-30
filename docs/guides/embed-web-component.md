# Embed: Web Component

Embed a Mog spreadsheet in any browser page with `<mog-sheet>` from `@mog-sdk/embed`.

The web component uses the same host-policy contract as the React component. Public markup must not pass raw `src` URLs or bytes. Set `config` to an opaque source ref and `hostPolicy` to a trusted same-origin resolver; the web-component host adapter resolves the source before creating the client, then resolves effective state into the read-only snapshot and `mog-effective-state-change` events.

```html
<mog-sheet id="sheet" style="width: 100%; height: 600px"></mog-sheet>

<script type="module">
  import '@mog-sdk/embed';

  const sheet = document.querySelector('#sheet');

  sheet.config = {
    source: { kind: 'document', ref: 'issued-source-ref' },
    requestedMode: 'readonly',
    requestedCapabilities: ['view', 'export'],
    requestedSavePolicy: 'export-only',
  };

  sheet.hostPolicy = {
    async resolveSource(config) {
      return {
        bytes: await loadAuthorizedXlsxBytes(config.source.ref),
        authorizationRef: 'authz-ref',
      };
    },
    resolveEffectiveState() {
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
      return exportAuthorizedWorkbook(format, state);
    },
  };

  sheet.addEventListener('mog-effective-state-change', (event) => {
    console.log(event.detail);
  });
</script>
```

`requestSave()` and `requestExport()` are allowed only when effective state grants the operation. Callback presence alone is never a grant: save requires `save` plus `host-callback` or `autosave` (live collaboration only allows `autosave`), and export requires `export` plus a non-`none` save policy. A raw `src` attribute is rejected with `mog-error`.
