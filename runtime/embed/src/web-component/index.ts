/**
 * @mog-sdk/embed/web-component — custom element entrypoint.
 *
 * @stability public-experimental
 * @remarks
 * Importing this entrypoint registers `<mog-sheet>` and exports the element
 * class for typed DOM integration.
 */

export { MogSheetElement } from '../mog-sheet-element';
export type {
  EmbedMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedResolvedSource,
  MogEmbedHostPolicy,
  MogEmbedLifecycleState,
  MogEmbedEventMap,
  MogEmbedConfigValidationError,
} from '../config';
export { validateMogEmbedConfig, assertValidMogEmbedConfig } from '../config';
