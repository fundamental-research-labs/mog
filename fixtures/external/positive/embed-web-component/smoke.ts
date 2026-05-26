// Root import registers <mog-sheet> as a side effect
import '@mog-sdk/embed';

import { MogSheetElement, SDK_VERSION, type EmbedStatus, type EmbedEventMap } from '@mog-sdk/embed';

import type {
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedHostPolicy,
  MogEmbedLifecycleState,
  MogEmbedSavePolicy,
  MogEmbedSourceRef,
} from '@mog-sdk/embed/config';

// Type-level checks
const _status: EmbedStatus = 'loading' as EmbedStatus;
const _source: MogEmbedSourceRef = { kind: 'document', ref: 'fixture-source-ref' };
const _savePolicy: MogEmbedSavePolicy = 'export-only';
const _lifecycleState: MogEmbedLifecycleState = 'ready';
const _config: MogEmbedConfig = {
  source: _source,
  requestedMode: 'readonly',
  requestedCapabilities: ['view', 'export'],
  requestedSavePolicy: _savePolicy,
};
const _effectiveState: MogEmbedEffectiveState = {
  mode: 'readonly',
  capabilities: ['view', 'export'],
  deniedCapabilities: [],
  savePolicy: 'export-only',
  collaboration: 'none',
  dirty: false,
  saveState: 'idle',
};
const _hostPolicy: MogEmbedHostPolicy = {
  resolveSource: () => ({
    bytes: new Uint8Array([80, 75, 3, 4]),
    authorizationRef: 'fixture-authorization',
  }),
  resolveEffectiveState: () => _effectiveState,
};

// Verify MogSheetElement is a class (web component)
if (typeof MogSheetElement !== 'function') {
  throw new Error('MogSheetElement missing');
}

// Verify SDK_VERSION is a string
if (typeof SDK_VERSION !== 'string') {
  throw new Error('SDK_VERSION missing');
}
if (
  _config.source.ref !== 'fixture-source-ref' ||
  _lifecycleState !== 'ready' ||
  typeof _hostPolicy.resolveSource !== 'function'
) {
  throw new Error('host policy types missing');
}

console.log('PASS: embed-web-component fixture');
