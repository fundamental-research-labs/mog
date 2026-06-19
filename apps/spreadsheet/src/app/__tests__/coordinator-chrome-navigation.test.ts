import { shouldRouteSpreadsheetChromeNavigationShortcut } from '../CoordinatorProvider';

function key(
  overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>> = {},
): Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> {
  return {
    key: 'Home',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

describe('spreadsheet chrome navigation routing', () => {
  it.each(['Home', 'End', 'PageDown', 'PageUp'])(
    'routes Ctrl/Cmd+%s from non-editable spreadsheet chrome',
    (navKey) => {
      const target = document.createElement('button');

      expect(
        shouldRouteSpreadsheetChromeNavigationShortcut(key({ key: navKey }), target),
      ).toBe(true);
      expect(
        shouldRouteSpreadsheetChromeNavigationShortcut(
          key({ key: navKey, ctrlKey: false, metaKey: true }),
          target,
        ),
      ).toBe(true);
    },
  );

  it('does not route unmodified, Alt-modified, or unrelated shortcuts', () => {
    const target = document.createElement('button');

    expect(
      shouldRouteSpreadsheetChromeNavigationShortcut(
        key({ ctrlKey: false, metaKey: false }),
        target,
      ),
    ).toBe(false);
    expect(shouldRouteSpreadsheetChromeNavigationShortcut(key({ altKey: true }), target)).toBe(
      false,
    );
    expect(shouldRouteSpreadsheetChromeNavigationShortcut(key({ key: 'ArrowDown' }), target)).toBe(
      false,
    );
  });

  it('preserves native keyboard ownership for editable controls and dialogs', () => {
    const input = document.createElement('input');
    const dialog = document.createElement('div');
    const dialogButton = document.createElement('button');
    dialog.setAttribute('role', 'dialog');
    dialog.appendChild(dialogButton);

    expect(shouldRouteSpreadsheetChromeNavigationShortcut(key(), input)).toBe(false);
    expect(shouldRouteSpreadsheetChromeNavigationShortcut(key(), dialogButton)).toBe(false);
  });
});
