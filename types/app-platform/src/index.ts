/**
 * @mog-sdk/types-app-platform — Canonical contract types for the Mog
 * app/plugin platform.
 *
 * Contracts-only: TypeScript types, validators, and pure helpers.
 * No React, shell implementation, kernel internals, or runtime-specific imports.
 *
 * Consumers should import from precise subpaths:
 *
 *   import type { AppManifest } from '@mog-sdk/types-app-platform/manifest';
 *   import type { PluginManifest } from '@mog-sdk/types-app-platform/plugin';
 */

export * from './manifest/index';
export * from './package/index';
export * from './lifecycle/index';
export * from './routing/index';
export * from './services/index';
export * from './capabilities/index';
export * from './contributions/index';
export * from './plugin/index';
export * from './trust/index';
