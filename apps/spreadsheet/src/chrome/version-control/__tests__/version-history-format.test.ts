import { formatRelativeCommitTime, shortCommitId } from '../version-history-format';

describe('version history formatting', () => {
  const now = Date.parse('2026-06-25T10:42:00.000Z');

  it('formats commit timestamps as GitHub-style relative time', () => {
    expect(formatRelativeCommitTime('2026-06-25T10:41:31.000Z', now)).toBe('just now');
    expect(formatRelativeCommitTime('2026-06-25T10:10:00.000Z', now)).toBe('32 minutes ago');
    expect(formatRelativeCommitTime('2026-06-25T09:12:00.000Z', now)).toBe('1 hour ago');
    expect(formatRelativeCommitTime('2026-06-22T10:42:00.000Z', now)).toBe('3 days ago');
    expect(formatRelativeCommitTime('2026-06-11T10:42:00.000Z', now)).toBe('2 weeks ago');
    expect(formatRelativeCommitTime('2026-05-25T10:42:00.000Z', now)).toBe('1 month ago');
    expect(formatRelativeCommitTime('2025-06-25T10:42:00.000Z', now)).toBe('1 year ago');
  });

  it('keeps invalid commit timestamps readable and handles clock skew', () => {
    expect(formatRelativeCommitTime('not-a-date', now)).toBe('not-a-date');
    expect(formatRelativeCommitTime('2026-06-25T10:45:00.000Z', now)).toBe('in 3 minutes');
  });

  it('shortens sha256 commit ids without touching provider-specific ids', () => {
    expect(shortCommitId(`commit:sha256:${'a'.repeat(64)}`)).toBe('aaaaaaaaaaaa');
    expect(shortCommitId('provider:commit:123')).toBe('provider:commit:123');
  });
});
