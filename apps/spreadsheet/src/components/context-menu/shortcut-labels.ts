import type { Platform } from '@mog-sdk/kernel/keyboard';

import { getShortcutById, toShortcutDisplayString } from '../../keyboard';

const FORMAT_CELLS_SHORTCUT_ID = 'open-format-cells-dialog';

export function getFormatCellsContextMenuShortcut(platform: Platform): string {
  const shortcut = getShortcutById(FORMAT_CELLS_SHORTCUT_ID);
  if (!shortcut) return platform === 'macos' ? '\u23181' : 'Ctrl+1';

  return toShortcutDisplayString(shortcut, platform);
}

export function platformFromShellInfo(info: { isMacOS: boolean; isLinux: boolean }): Platform {
  if (info.isMacOS) return 'macos';
  if (info.isLinux) return 'linux';
  return 'windows';
}
