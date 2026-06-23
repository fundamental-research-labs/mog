const FORBIDDEN_DETAIL_TERMS = [
  'hidden',
  'deleted',
  'protected',
  'external',
  'agent',
  'opaque',
  'principal-secret',
  'user-secret',
  'refs/heads',
  'sheet1!a1',
  'salary-secret',
  'raw-value-secret',
  'commit-secret',
  'namespace-secret',
  'client-secret',
  'session-secret',
  'graph-secret',
];

export function expectNoForbiddenDetails(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const term of FORBIDDEN_DETAIL_TERMS) {
    expect(serialized).not.toContain(term);
  }
}
