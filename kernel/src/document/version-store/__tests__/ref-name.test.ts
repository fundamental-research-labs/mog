import {
  RefNameValidationError,
  encodeKeyComponent,
  encodeRefNameForStorage,
  isRefName,
  parseRefName,
  refNameStorageKey,
  validateRefName,
  type RefNameValidationIssue,
} from '../refs/ref-name';

const VALID_REF_NAMES = [
  'main',
  'scenario/budget',
  'scenario/fy2026.plan_a-1',
  'scenario/a/b/c',
  'scenario/a_b.c-d/e2',
  'scenario/clock',
  'scenario/a',
  'agent/a',
  'import/a',
  'review/a',
  'agent/run_001',
  'import/xlsx-2026_06_20',
  'review/pr-42',
  `scenario/${'a'.repeat(119)}`,
] as const;

const OVER_128_BYTES = `scenario/${'a'.repeat(120)}`;

describe('RefName validation', () => {
  it.each(VALID_REF_NAMES)('accepts valid VC-05 ref name %s', (value) => {
    const result = validateRefName(value);

    expect(result).toEqual({ ok: true, name: value, diagnostics: [] });
    expect(parseRefName(value)).toBe(value);
    expect(isRefName(value)).toBe(true);
  });

  it.each([
    ['empty', '', 'empty'],
    ['uppercase namespace', 'Scenario/budget', 'containsUppercase'],
    ['uppercase slug', 'scenario/Budget', 'containsUppercase'],
    ['unknown namespace', 'feature/budget', 'unknownNamespace'],
    ['reserved detached', 'detached', 'reservedDetached'],
    ['reserved system ref', 'refs/system/checkouts/a', 'reservedSystemRef'],
    ['raw refs path', 'refs/heads/main', 'invalidFormat'],
    ['missing scenario namespace slash', 'scenario', 'invalidFormat'],
    ['missing agent namespace slash', 'agent', 'invalidFormat'],
    ['missing import namespace slash', 'import', 'invalidFormat'],
    ['missing review namespace slash', 'review', 'invalidFormat'],
    ['empty namespace child', 'scenario/', 'trailingSlash'],
    ['main child', 'main/child', 'unknownNamespace'],
    ['leading slash', '/scenario/budget', 'leadingSlash'],
    ['trailing slash', 'scenario/budget/', 'trailingSlash'],
    ['empty segment', 'scenario//budget', 'emptySegment'],
    ['nested empty segment', 'scenario/a//budget', 'emptySegment'],
    ['single dot segment', 'scenario/.', 'invalidFormat'],
    ['nested single dot segment', 'scenario/a/./b', 'invalidFormat'],
    ['dot dot segment', 'scenario/..', 'containsDotDot'],
    ['dot dot', 'scenario/foo..bar', 'containsDotDot'],
    ['whitespace', 'scenario/foo bar', 'containsWhitespace'],
    ['control character', 'scenario/foo\tbar', 'containsControl'],
    ['percent', 'scenario/foo%bar', 'containsPercent'],
    ['non ascii', 'scenario/cafe\u00e9', 'nonAscii'],
    ['lock segment', 'scenario/.lock', 'lockSegment'],
    ['nested lock segment', 'scenario/a/.lock/b', 'lockSegment'],
    ['segment ending lock', 'scenario/foo.lock', 'segmentEndsWithLock'],
    ['nested segment ending lock', 'scenario/a/foo.lock/b', 'segmentEndsWithLock'],
    ['segment starts dot', 'scenario/.hidden', 'invalidFormat'],
    ['segment ends dot', 'scenario/hidden.', 'invalidFormat'],
    ['nested segment ends dot', 'scenario/a/hidden./b', 'invalidFormat'],
    ['segment starts hyphen', 'scenario/-hidden', 'invalidFormat'],
    ['segment ends hyphen', 'scenario/hidden-', 'invalidFormat'],
    ['nested segment starts hyphen', 'scenario/a/-hidden/b', 'invalidFormat'],
    ['nested segment ends hyphen', 'scenario/a/hidden-/b', 'invalidFormat'],
    ['at brace sequence', 'scenario/foo@{bar', 'invalidFormat'],
    ['tilde', 'scenario/foo~bar', 'invalidFormat'],
    ['colon', 'scenario/foo:bar', 'invalidFormat'],
    ['question mark', 'scenario/foo?bar', 'invalidFormat'],
    ['asterisk', 'scenario/foo*bar', 'invalidFormat'],
    ['open bracket', 'scenario/foo[bar', 'invalidFormat'],
    ['caret', 'scenario/foo^bar', 'invalidFormat'],
    ['backslash', 'scenario/foo\\bar', 'invalidFormat'],
    ['over 128 bytes', OVER_128_BYTES, 'tooLong'],
  ] satisfies readonly (readonly [string, string, RefNameValidationIssue])[])(
    'rejects invalid VC-05 ref name: %s',
    (_label, value, issue) => {
      const result = validateRefName(value);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected invalid RefName');
      expect(result.diagnostics.map((diagnostic) => diagnostic.issue)).toContain(issue);
      expect(isRefName(value)).toBe(false);
      expect(() => parseRefName(value)).toThrow(RefNameValidationError);
    },
  );

  it.each([undefined, null, 42, {}, []])('rejects non-string ref name %p', (value) => {
    const result = validateRefName(value);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid RefName');
    expect(result.diagnostics.map((diagnostic) => diagnostic.issue)).toContain('notString');
    expect(isRefName(value)).toBe(false);
    expect(() => parseRefName(value)).toThrow(RefNameValidationError);
  });
});

describe('RefName storage encoding', () => {
  it.each([
    ['main', 'main', 'refs/heads/main'],
    ['scenario/budget', 'scenario%2Fbudget', 'refs/heads/scenario%2Fbudget'],
    [
      'scenario/fy2026.plan_a-1/nested',
      'scenario%2Ffy2026.plan_a-1%2Fnested',
      'refs/heads/scenario%2Ffy2026.plan_a-1%2Fnested',
    ],
  ] as const)('encodes valid ref name %s under refs/heads', (value, encoded, storageKey) => {
    const name = parseRefName(value);

    expect(encodeRefNameForStorage(name)).toBe(encoded);
    expect(refNameStorageKey(name)).toBe(storageKey);
  });

  it.each([
    ['slash', 'scenario/raw', 'scenario%2Fraw'],
    ['percent', 'raw%component', 'raw%25component'],
    ['non ascii utf8 bytes', '\u00e9', '%C3%A9'],
    ['mixed', 'a/%/\u00e9', 'a%2F%25%2F%C3%A9'],
  ] as const)('encodes raw key component bytes: %s', (_label, value, encoded) => {
    expect(encodeKeyComponent(value)).toBe(encoded);
  });
});
