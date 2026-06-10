/**
 * Platform identity factory.
 *
 * Creates a frozen PlatformIdentity at boot. Synchronous, zero-dependency.
 * All platform-branching code receives this value via injection.
 */

import type { PlatformIdentity } from '@mog-sdk/contracts/platform';
import { isTauri } from './tauri/detection';

function detectAppEvalOSOverride(): PlatformIdentity['os'] | null {
  if (typeof window === 'undefined') return null;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('app-eval-platform-mac')) return 'macos';
  } catch {
    // Ignore malformed or unavailable location state and use host detection.
  }

  return null;
}

/**
 * Detect the host operating system.
 *
 * Uses navigator.userAgentData (modern Chromium) with fallback to
 * navigator.platform (Safari, older browsers). Both work correctly
 * inside Tauri's webview.
 */
function detectOS(): PlatformIdentity['os'] {
  const appEvalOverride = detectAppEvalOSOverride();
  if (appEvalOverride) return appEvalOverride;

  if (typeof navigator === 'undefined') return 'windows'; // SSR / test default

  // Modern API (Chromium 93+, Edge 93+). Works in Tauri's webview.
  const uaData = navigator.userAgentData;
  if (uaData?.platform) {
    const p = uaData.platform.toLowerCase();
    if (p === 'macos' || p.includes('mac')) return 'macos';
    if (p === 'linux') return 'linux';
    return 'windows';
  }

  // Fallback for Safari / older browsers
  const p = (navigator.platform ?? '').toLowerCase();
  if (p.includes('mac')) return 'macos';
  if (p.includes('linux')) return 'linux';
  return 'windows';
}

/**
 * Create the platform identity for the current environment.
 *
 * Call once at app boot, pass everywhere. Synchronous and immediate.
 */
export function createPlatformIdentity(): PlatformIdentity {
  const runtime = isTauri() ? 'desktop' : 'web';
  const os = detectOS();
  return Object.freeze({ os, runtime });
}

/**
 * Create a PlatformIdentity for tests.
 *
 * Defaults to { os: 'windows', runtime: 'web' } — the most common
 * test environment. Override any field as needed.
 */
export function createTestPlatformIdentity(
  overrides?: Partial<PlatformIdentity>,
): PlatformIdentity {
  return Object.freeze({
    os: 'windows',
    runtime: 'web',
    ...overrides,
  });
}
