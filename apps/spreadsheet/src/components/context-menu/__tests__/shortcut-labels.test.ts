import { getFormatCellsContextMenuShortcut, platformFromShellInfo } from '../shortcut-labels';

describe('context menu shortcut labels', () => {
  it('advertises the Format Cells shortcut as Command+1 on macOS', () => {
    const shortcut = getFormatCellsContextMenuShortcut('macos');

    expect(shortcut).toBe('\u23181');
    expect(shortcut).not.toContain('Control');
    expect(shortcut).not.toContain('Ctrl');
  });

  it('keeps the Format Cells shortcut as Ctrl+1 off macOS', () => {
    expect(getFormatCellsContextMenuShortcut('windows')).toBe('Ctrl+1');
    expect(getFormatCellsContextMenuShortcut('linux')).toBe('Ctrl+1');
  });

  it('maps shell platform info to keyboard platforms', () => {
    expect(platformFromShellInfo({ isMacOS: true, isLinux: false })).toBe('macos');
    expect(platformFromShellInfo({ isMacOS: false, isLinux: true })).toBe('linux');
    expect(platformFromShellInfo({ isMacOS: false, isLinux: false })).toBe('windows');
  });
});
