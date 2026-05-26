import type { Platform } from '@mog-sdk/contracts/keyboard';

/** Detect platform from navigator user agent. */
export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('linux')) return 'linux';
  }
  return 'windows';
}
