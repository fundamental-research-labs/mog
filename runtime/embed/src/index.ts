/**
 * @mog-sdk/embed — Embeddable read-only Mog spreadsheet component.
 *
 * @stability public-experimental
 * @remarks
 * This is the root entrypoint for `@mog-sdk/embed`. All symbols exported from
 * this path are classified `public-experimental` per public exposure tiers
 * unless individually marked otherwise. No long-term compatibility promise yet;
 * packed-artifact gates (public package boundary) must pass before promotion to stable.
 *
 * Tier 0 (HTML-only):
 *   <script type="module" src="https://assets.sheetmog.ai/v/0.1.0/embed.js"></script>
 *   <mog-sheet></mog-sheet>
 *
 * Tier 1 (JS/TS):
 *   import '@mog-sdk/embed';
 *   const sheet = document.querySelector('mog-sheet');
 *   await sheet.ready;
 *
 * Tier 2 (React):
 *   import { MogSheet } from '@mog-sdk/embed/react';
 *   <MogSheet config={config} hostPolicy={hostPolicy} width={1200} height={600} />
 */

import './mog-sheet-element';

// Embed-specific types
/** @stability public-experimental */
export type { EmbedStatus, EmbedRendererOptions, EmbedEventMap } from './types';

// Web Component (side effect: registers <mog-sheet>)
/** @stability public-experimental */
export { MogSheetElement } from './mog-sheet-element';

// Shared configuration model
/** @stability public-experimental */
export type {
  EmbedMode,
  MogEmbedSourceRef,
  MogEmbedChromeOptions,
  MogEmbedThemeOptions,
  MogEmbedSavePolicy,
  MogEmbedCollaborationMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedResolvedSource,
  MogEmbedHostPolicy,
  MogEmbedLifecycleState,
  MogEmbedEventMap,
  MogEmbedConfigValidationError,
} from './config';
/** @stability public-experimental */
export { validateMogEmbedConfig, assertValidMogEmbedConfig } from './config';

// Version (injected at build time by tsup define)
declare const __SDK_VERSION__: string;
/** @stability public-experimental */
export const SDK_VERSION = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';
