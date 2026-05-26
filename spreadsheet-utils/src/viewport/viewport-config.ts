/**
 * Viewport Config Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/viewport/viewport-config.
 */

import type {
  FreezeViewportConfig,
  PersistedViewportConfig,
  SingleViewportConfig,
  SplitViewportConfig,
} from '@mog-sdk/contracts/viewport/viewport-config';

export function createSingleViewportConfig(): SingleViewportConfig {
  return { type: 'single' };
}

export function createFreezeViewportConfig(rows: number, cols: number): FreezeViewportConfig {
  return { type: 'freeze', rows: Math.max(0, rows), cols: Math.max(0, cols) };
}

export function createSplitViewportConfig(
  direction: 'horizontal' | 'vertical' | 'both',
  horizontalPosition: number = 0,
  verticalPosition: number = 0,
): SplitViewportConfig {
  return {
    type: 'split',
    direction,
    horizontalPosition: Math.max(0, horizontalPosition),
    verticalPosition: Math.max(0, verticalPosition),
  };
}

export function isEffectivelySingleViewport(config: PersistedViewportConfig): boolean {
  if (config.type === 'single') return true;
  if (config.type === 'freeze') return config.rows === 0 && config.cols === 0;
  return false;
}
