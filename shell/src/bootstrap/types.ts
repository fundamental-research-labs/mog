/**
 * Shell Bootstrap Types
 *
 * Defines the contract for shell initialization that happens BEFORE React mounts.
 * This ensures all system event handling (menus, IPC, shortcuts) is wired up
 * before any React components render.
 *
 */

import type { StoreApi } from 'zustand';
import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';
import type { IPlatform, PlatformIdentity } from '@mog-sdk/contracts/platform';
import type { ShellService } from '@mog-sdk/types-document/shell/types';
import type { DocumentManager } from '../services/document';
import type { DocumentRuntimeAssetOptions } from '../services/document/types';
import type { ProjectService } from '../services/project';
import type { RecentDocsStore } from '../services/recent-docs';
import type { ShellUIState } from '../ui-store/shell-store';
import type { CollabConfig } from '../services/collab-room';
import type { EventDispatcher } from './dispatcher-types';

export type ShellBootstrapCapabilityRegistry = ICapabilityRegistry & { dispose?: () => void };

// =============================================================================
// Bootstrap Configuration
// =============================================================================

/**
 * Configuration for shell bootstrap.
 */
export interface ShellBootstrapConfig {
  /**
   * Optional platform override (for testing).
   * If not provided, platform is auto-detected and created.
   */
  platform?: IPlatform;

  /**
   * Timeout for platform initialization (ms).
   * If platform init takes longer, continues without platform.
   * @default 3000
   */
  platformTimeout?: number;

  /**
   * Optional collab server URL. When provided, enables the collaboration
   * toggle in the toolbar. The shell uses this to connect the WS sidecar.
   * @deprecated Use `collab` instead for full config including user identity.
   */
  collabUrl?: string;

  /**
   * Full collaboration config. When provided, takes precedence over `collabUrl`.
   * Includes user identity, room ID resolver, and WS base URL.
   */
  collab?: CollabConfig;

  /**
   * Browser runtime asset overrides for trusted hosts embedding the shell/app.
   * Defaults preserve standalone web behavior.
   */
  runtimeAssets?: DocumentRuntimeAssetOptions;

  /**
   * Whether to show the browser's "leave site?" prompt when there is
   * unflushed document data on `beforeunload`. Defaults to `true`.
   *
   * Set to `false` when the host manages its own unsaved-changes UX
   * or on localhost where the prompt interferes with hot reload.
   */
  beforeUnloadPrompt?: boolean;

  /**
   * Optional capability registry supplied by a trusted host/runtime.
   * If omitted, shell creates and owns a default in-memory registry.
   */
  capabilityRegistry?: ShellBootstrapCapabilityRegistry;
}

// =============================================================================
// Bootstrap Result
// =============================================================================

/**
 * Result of shell bootstrap - everything needed to run the app.
 *
 * All properties are fully initialized and ready to use.
 * React components receive this and don't do any async initialization.
 */
export interface ShellBootstrapResult {
  /**
   * Static platform identity (os + runtime).
   * Always available — created synchronously at boot.
   */
  platformIdentity: PlatformIdentity;

  /**
   * Platform instance.
   * Null if running in web browser (no native features).
   */
  platform: IPlatform | null;

  /**
   * Shell UI store (always created, even for web).
   * Contains navigation, record detail, and project state.
   */
  store: StoreApi<ShellUIState>;

  /**
   * Project service for file/folder operations.
   * Null if no platform (web browser).
   */
  projectService: ProjectService | null;

  /**
   * Document manager for document lifecycle.
   * Manages loading, caching, and disposal of documents.
   * Created before ProjectService and survives React remounts.
   */
  documentManager: DocumentManager;

  /**
   * Shell service: typed facade exposing document lifecycle ops to action
   * handlers (shell-service facade). Composes documentManager +
   * projectService into a single capability surface so handlers do not
   * need to reach `window.__SHELL__`.
   *
   * Null when no `projectService` (web browser without native platform);
   * web shells that need handler dispatch must arrange a different shell
   * service instance.
   */
  shellService: ShellService | null;

  /**
   * Event dispatcher for system events (menu, keyboard, IPC).
   * Handles events outside of React's render cycle.
   */
  eventDispatcher: EventDispatcher;

  /**
   * Recent-docs zustand store (current implementation §6.2). Mirrors the IndexedDB Meta
   * API. `hydrate()` is kicked off in parallel with WASM init — the
   * bootstrap does **not** await it (the slice's `loaded: boolean`
   * gates consumers that need to wait). Welcome screen and the §6.2
   * boot precedence table read this to decide which doc to reopen.
   */
  recentDocsStore: RecentDocsStore;

  /**
   * Collab server URL, resolved from config.
   * Null if collab is not configured.
   */
  collabUrl: string | null;

  /**
   * Full collab config, resolved from `config.collab` or synthesized from `config.collabUrl`.
   * Null if collab is not configured.
   */
  collabConfig: CollabConfig | null;

  /**
   * Capability authority for this shell runtime.
   * Hosts may inject a policy-specific registry; otherwise shell owns the default.
   */
  capabilityRegistry: ShellBootstrapCapabilityRegistry;

  /**
   * Cleanup function to dispose of resources.
   * Call when shutting down the app. Await the returned promise before
   * reusing public document IDs in a new shell/runtime.
   */
  dispose: () => Promise<void>;
}
