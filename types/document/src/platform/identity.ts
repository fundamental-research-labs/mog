/**
 * Supported operating system platforms.
 *
 * Canonical type for OS identity — used by PlatformIdentity, keyboard shortcut
 * resolution, and any code that branches on the host OS.
 */
export type Platform = 'macos' | 'windows' | 'linux';

/**
 * Static platform identity — created once at boot, never changes.
 *
 * This is the single source of truth for "what platform am I on?"
 * All platform-branching code receives this value instead of
 * calling navigator.platform or other detection APIs.
 *
 * Deliberately minimal: only the two facts that platform-branching
 * code actually needs. No version, no capabilities, no keyboard layout.
 */
export interface PlatformIdentity {
  /** The host operating system. Definitive on desktop, best-effort on web. */
  readonly os: Platform;
  /** Desktop (Tauri) or Web (browser). */
  readonly runtime: 'desktop' | 'web';
}
