/**
 * @mog-sdk/embed/publish — Read-only publish product.
 *
 * @stability public-experimental
 * @remarks
 * This is a security pipeline, not "embed with readOnly=true". The publish
 * surface enforces: no mutation, no collaboration writes, no raw provider
 * payloads, no CRDT bytes, no raw storage snapshots at the type and
 * runtime level.
 */

/** @stability public-experimental */
export type {
  PublishCachePolicy,
  PublishSecurityPolicy,
  PublishMetadata,
  MogPublishArtifact,
  MogPublishConfig,
  PublishChromeOptions,
  MogPublishEffectiveState,
  PublishViewStatus,
  PublishViewHandle,
  PublishViewEventMap,
} from './types';

/** @stability public-experimental */
export { createPublishView } from './mount';
/** @stability public-experimental */
export { validatePublishConfig, createDefaultSecurityPolicy } from './mount';
