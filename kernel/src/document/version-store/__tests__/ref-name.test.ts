import {
  RefNameValidationError,
  encodeKeyComponent,
  encodeRefNameForStorage,
  isRefName,
  parseRefName,
  refNameStorageKey,
  validateRefName,
  validateRefNamePrefix,
  type RefNameValidationIssue,
} from '../refs/ref-name';

const VALID_REF_NAMES = [
  'main',
  'budget',
  'budget-q1',
  'feature/budget',
  'fy2026.plan_a-1',
  'a/b/c',
  'a_b.c-d/e2',
  'clock',
  'scenario',
  'agent',
  'import',
  'review',
  'agent/run_001',
  'xlsx-2026_06_20',
  'pr-42',
  `${'a'.repeat(128)}`,
] as const;

const OVER_128_BYTES = 'a'.repeat(129);

describe('RefName validation', () => {
  it.each(VALID_REF_NAMES)('accepts valid VC-05 ref name %s', (value) => {
    const result = validateRefName(value);

    expect(result).toEqual({ ok: true, name: value, diagnostics: [] });
    expect(parseRefName(value)).toBe(value);
    expect(isRefName(value)).toBe(true);
  });

  it.each([
    ['empty', '', 'empty'],
    ['uppercase first segment', 'Feature/budget', 'containsUppercase'],
    ['uppercase nested segment', 'feature/Budget', 'containsUppercase'],
    ['reserved detached', 'detached', 'reservedDetached'],
    ['reserved refs prefix', 'refs/heads/main', 'reservedRefsPrefix'],
    ['reserved system ref', 'refs/system/checkouts/a', 'reservedSystemRef'],
    ['empty child', 'budget/', 'trailingSlash'],
    ['main child', 'main/child', 'reservedMainPrefix'],
    ['leading slash', '/budget', 'leadingSlash'],
    ['trailing slash', 'budget/', 'trailingSlash'],
    ['empty segment', 'budget//q1', 'emptySegment'],
    ['nested empty segment', 'budget/a//q1', 'emptySegment'],
    ['single dot segment', 'budget/.', 'invalidFormat'],
    ['nested single dot segment', 'budget/a/./b', 'invalidFormat'],
    ['dot dot segment', 'budget/..', 'containsDotDot'],
    ['dot dot', 'budget/foo..bar', 'containsDotDot'],
    ['whitespace', 'budget/foo bar', 'containsWhitespace'],
    ['control character', 'budget/foo\tbar', 'containsControl'],
    ['percent', 'budget/foo%bar', 'containsPercent'],
    ['non ascii', 'budget/cafe\u00e9', 'nonAscii'],
    ['lock segment', 'budget/.lock', 'lockSegment'],
    ['nested lock segment', 'budget/a/.lock/b', 'lockSegment'],
    ['segment ending lock', 'budget/foo.lock', 'segmentEndsWithLock'],
    ['nested segment ending lock', 'budget/a/foo.lock/b', 'segmentEndsWithLock'],
    ['segment starts dot', 'budget/.hidden', 'invalidFormat'],
    ['segment ends dot', 'budget/hidden.', 'invalidFormat'],
    ['nested segment ends dot', 'budget/a/hidden./b', 'invalidFormat'],
    ['segment starts hyphen', 'budget/-hidden', 'invalidFormat'],
    ['segment ends hyphen', 'budget/hidden-', 'invalidFormat'],
    ['nested segment starts hyphen', 'budget/a/-hidden/b', 'invalidFormat'],
    ['nested segment ends hyphen', 'budget/a/hidden-/b', 'invalidFormat'],
    ['at brace sequence', 'budget/foo@{bar', 'invalidFormat'],
    ['tilde', 'budget/foo~bar', 'invalidFormat'],
    ['colon', 'budget/foo:bar', 'invalidFormat'],
    ['question mark', 'budget/foo?bar', 'invalidFormat'],
    ['asterisk', 'budget/foo*bar', 'invalidFormat'],
    ['open bracket', 'budget/foo[bar', 'invalidFormat'],
    ['caret', 'budget/foo^bar', 'invalidFormat'],
    ['backslash', 'budget/foo\\bar', 'invalidFormat'],
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

describe('RefName prefix validation', () => {
  it.each(['budget', 'budget-q', 'budget/', 'feature/budget'])(
    'accepts valid ref prefix %s',
    (value) => {
      const result = validateRefNamePrefix(value);

      expect(result).toEqual({ ok: true, prefix: value, diagnostics: [] });
    },
  );

  it.each([
    ['empty', '', 'empty'],
    ['raw refs path', 'refs/heads/budget', 'reservedRefsPrefix'],
    ['main child', 'main/', 'reservedMainPrefix'],
    ['invalid segment', 'budget//', 'trailingSlash'],
  ] satisfies readonly (readonly [string, string, RefNameValidationIssue])[])(
    'rejects invalid ref prefix: %s',
    (_label, value, issue) => {
      const result = validateRefNamePrefix(value);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected invalid RefName prefix');
      expect(result.diagnostics.map((diagnostic) => diagnostic.issue)).toContain(issue);
    },
  );
});

describe('RefName storage encoding', () => {
  it.each([
    ['main', 'main', 'refs/heads/main'],
    ['budget', 'budget', 'refs/heads/budget'],
    ['fy2026.plan_a-1/nested', 'fy2026.plan_a-1%2Fnested', 'refs/heads/fy2026.plan_a-1%2Fnested'],
  ] as const)('encodes valid ref name %s under refs/heads', (value, encoded, storageKey) => {
    const name = parseRefName(value);

    expect(encodeRefNameForStorage(name)).toBe(encoded);
    expect(refNameStorageKey(name)).toBe(storageKey);
  });

  it.each([
    ['slash', 'budget/raw', 'budget%2Fraw'],
    ['percent', 'raw%component', 'raw%25component'],
    ['non ascii utf8 bytes', '\u00e9', '%C3%A9'],
    ['mixed', 'a/%/\u00e9', 'a%2F%25%2F%C3%A9'],
  ] as const)('encodes raw key component bytes: %s', (_label, value, encoded) => {
    expect(encodeKeyComponent(value)).toBe(encoded);
  });
});
