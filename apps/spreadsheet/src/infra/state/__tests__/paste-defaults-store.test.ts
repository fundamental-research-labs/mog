import {
  LEGACY_PASTE_DEFAULTS_V1,
  PASTE_DEFAULTS_STORAGE_KEY,
  readPasteDefaultsPreference,
  sanitizePasteDefaultsPreference,
  writePasteDefaultsPreference,
} from '../paste-defaults-store';

describe('paste-defaults-store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sanitizes invalid persisted values to legacy defaults', () => {
    expect(sanitizePasteDefaultsPreference(undefined)).toEqual(LEGACY_PASTE_DEFAULTS_V1);
    expect(sanitizePasteDefaultsPreference('{bad json')).toEqual(LEGACY_PASTE_DEFAULTS_V1);
    expect(sanitizePasteDefaultsPreference({ version: 2, defaultPasteType: 'values' })).toEqual(
      LEGACY_PASTE_DEFAULTS_V1,
    );
    expect(
      sanitizePasteDefaultsPreference({
        version: 1,
        defaultPasteType: 'comments',
        skipBlanks: false,
        transpose: false,
      }),
    ).toEqual(LEGACY_PASTE_DEFAULTS_V1);
    expect(
      sanitizePasteDefaultsPreference({
        version: 1,
        defaultPasteType: 'values',
        skipBlanks: 'yes',
        transpose: false,
      }),
    ).toEqual(LEGACY_PASTE_DEFAULTS_V1);
  });

  it('persists only the V1 allowlist', () => {
    writePasteDefaultsPreference({
      version: 1,
      defaultPasteType: 'formats',
      skipBlanks: true,
      transpose: true,
      extra: 'drop-me',
    } as any);

    expect(JSON.parse(window.localStorage.getItem(PASTE_DEFAULTS_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      defaultPasteType: 'formats',
      skipBlanks: true,
      transpose: true,
    });
    expect(readPasteDefaultsPreference()).toEqual({
      version: 1,
      defaultPasteType: 'formats',
      skipBlanks: true,
      transpose: true,
    });
  });

  it('returns a stable snapshot when the persisted preference is unchanged', () => {
    const first = readPasteDefaultsPreference();
    const second = readPasteDefaultsPreference();
    expect(second).toBe(first);

    writePasteDefaultsPreference({
      version: 1,
      defaultPasteType: 'values',
      skipBlanks: true,
      transpose: false,
    });

    const afterWrite = readPasteDefaultsPreference();
    const repeated = readPasteDefaultsPreference();
    expect(repeated).toBe(afterWrite);
    expect(afterWrite).not.toBe(first);
  });

  it('falls back safely when stored JSON is corrupt', () => {
    window.localStorage.setItem(PASTE_DEFAULTS_STORAGE_KEY, '{');
    expect(readPasteDefaultsPreference()).toEqual(LEGACY_PASTE_DEFAULTS_V1);
  });
});
