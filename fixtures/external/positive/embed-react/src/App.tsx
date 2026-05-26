import {
  MogSheet,
  type MogEmbedConfig,
  type MogEmbedEffectiveState,
  type MogEmbedHostPolicy,
  type MogSheetProps,
} from '@mog-sdk/embed/react';

const config: MogEmbedConfig = {
  source: { kind: 'document', ref: 'fixture-source-ref' },
  requestedMode: 'readonly',
  requestedCapabilities: ['view', 'export'],
  requestedSavePolicy: 'export-only',
};

const effectiveState: MogEmbedEffectiveState = {
  mode: 'readonly',
  capabilities: ['view', 'export'],
  deniedCapabilities: [],
  savePolicy: 'export-only',
  collaboration: 'none',
  dirty: false,
  saveState: 'idle',
};

const hostPolicy: MogEmbedHostPolicy = {
  resolveSource: () => ({
    bytes: new Uint8Array([80, 75, 3, 4]),
    authorizationRef: 'fixture-authorization',
  }),
  resolveEffectiveState: () => effectiveState,
};

export function App() {
  const props: MogSheetProps = {
    config,
    hostPolicy,
  };

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <MogSheet {...props} />
    </div>
  );
}
