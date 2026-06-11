import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

describe('CollapsedGroupDropdown dense layout', () => {
  it('keeps compact labels visible on collapsed group buttons at narrow collapse levels', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/primitives/CollapsedGroupDropdown.tsx'),
      'utf8',
    );

    expect(source).toContain('const isDense = level >= 3');
    expect(source).toContain("isDense ? 'px-1' : 'px-[var(--ribbon-group-padding-x)]'");
    expect(source).toContain('text-ribbon-compact text-ss-text-secondary');
    expect(source).toContain('<span className={labelClassName}>{label}</span>');
  });

  it('can be forced open by store-controlled child dropdown state', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/primitives/CollapsedGroupDropdown.tsx'),
      'utf8',
    );
    const toolbarGroupSource = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/primitives/ToolbarGroup.tsx'),
      'utf8',
    );
    const viewRibbonSource = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/tabs/ViewRibbon.tsx'),
      'utf8',
    );

    expect(source).toContain('forceOpen?: boolean');
    expect(source).toContain('const popoverOpen = isOpen || forceOpen');
    expect(toolbarGroupSource).toContain('openWhenRibbonDropdowns?: readonly RibbonDropdownId[]');
    expect(toolbarGroupSource).toContain('state.ribbonDropdowns[dropdownId] === true');
    expect(viewRibbonSource).toContain("openWhenRibbonDropdowns={['view.freeze-panes']}");
    expect(viewRibbonSource).toContain("const renderFreezeMenuInline = windowGroupRenderMode === 'dropdown'");
    expect(viewRibbonSource).toContain('const freezePanesMenu = (');
    expect(viewRibbonSource).toContain('firstItem?.focus()');
    expect(viewRibbonSource).toContain('restoreGridFocusAfterMenuClose');
    expect(viewRibbonSource).toContain('coordinatorInput?.focusGrid?.()');
  });
});
