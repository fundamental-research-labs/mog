/**
 * GPU Memory Detection — Canvas Memory Limit Detection
 *
 * GPU memory is a hard constraint: two 4K canvases at 2x DPR consume ~264MB,
 * but Mobile Safari has a ~256MB limit.
 *
 * This is NOT a feature flag — it is runtime hardware capability detection
 * (like checking WebGL support).
 *
 * @module @mog/canvas-engine/gpu
 */

export type CanvasMemoryMode = 'multi-canvas' | 'single-canvas';

/**
 * Detect available GPU memory and determine if multi-canvas mode is safe.
 *
 * Detection strategy:
 * 1. navigator.deviceMemory if available
 * 2. Attempt to allocate test canvas and detect failure
 * 3. Known-bad UA patterns (Mobile Safari on low-memory devices)
 */
export function detectCanvasMemoryLimit(): CanvasMemoryMode {
  // 1. Check navigator.deviceMemory
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === 'number' && deviceMemory < 4) {
    return 'single-canvas';
  }

  // 2. Check for known-bad environments (Mobile Safari)
  if (isMobileSafari()) {
    // Mobile Safari has a hard ~256MB canvas memory limit.
    // Two 4K canvases at 2x DPR would exceed this.
    // Be conservative: use single-canvas on all iOS devices.
    return 'single-canvas';
  }

  // 3. Attempt canvas allocation test
  if (!canAllocateCanvas()) {
    return 'single-canvas';
  }

  return 'multi-canvas';
}

function isMobileSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iOS Safari: contains 'iPhone' or 'iPad' with 'Safari'
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua);
}

/**
 * Attempt to allocate a test canvas at the expected size.
 * If the canvas returns 0x0 or the allocation throws, multi-canvas is unsafe.
 */
function canAllocateCanvas(): boolean {
  try {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const testWidth = Math.floor(1920 * dpr);
    const testHeight = Math.floor(1080 * dpr);

    const canvas = document.createElement('canvas');
    canvas.width = testWidth;
    canvas.height = testHeight;

    // Check if allocation actually succeeded
    if (canvas.width === 0 || canvas.height === 0) {
      return false;
    }

    // Try to get context (this can fail on memory-constrained devices)
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    // Clean up
    canvas.width = 0;
    canvas.height = 0;

    return true;
  } catch {
    return false;
  }
}
