/**
 * Capability Subject Tests
 */

import {
  createCapabilitySubject,
  isNarrowedBy,
  subjectKey,
  subjectMatches,
  subjectSpecificity,
  subjectsEqual,
} from '../capability-subject';

describe('createCapabilitySubject', () => {
  it('should create a frozen subject with only specified fields', () => {
    const subject = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subject.appId).toBe('foo');
    expect(subject.instanceId).toBe('123');
    expect(subject.packageId).toBeUndefined();
    expect(Object.isFrozen(subject)).toBe(true);
  });

  it('should strip undefined fields', () => {
    const subject = createCapabilitySubject({ appId: 'foo', pluginId: undefined });
    expect('pluginId' in subject).toBe(false);
  });

  it('should create an empty subject', () => {
    const subject = createCapabilitySubject({});
    expect(Object.keys(subject)).toHaveLength(0);
  });
});

describe('subjectMatches', () => {
  it('should match when grant has subset of query fields', () => {
    const grant = createCapabilitySubject({ appId: 'foo' });
    const query = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectMatches(grant, query)).toBe(true);
  });

  it('should not match when grant field differs from query', () => {
    const grant = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    const query = createCapabilitySubject({ appId: 'foo', instanceId: '456' });
    expect(subjectMatches(grant, query)).toBe(false);
  });

  it('should match empty grant against any query', () => {
    const grant = createCapabilitySubject({});
    const query = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectMatches(grant, query)).toBe(true);
  });

  it('should match identical subjects', () => {
    const grant = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    const query = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectMatches(grant, query)).toBe(true);
  });

  it('should not match when grant requires a field the query lacks', () => {
    const grant = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    const query = createCapabilitySubject({ appId: 'foo' });
    expect(subjectMatches(grant, query)).toBe(false);
  });

  it('should match when grant and query have different extra fields', () => {
    const grant = createCapabilitySubject({ appId: 'foo' });
    const query = createCapabilitySubject({ appId: 'foo', workspaceId: 'ws-1' });
    expect(subjectMatches(grant, query)).toBe(true);
  });

  it('should not match mismatched appId', () => {
    const grant = createCapabilitySubject({ appId: 'foo' });
    const query = createCapabilitySubject({ appId: 'bar' });
    expect(subjectMatches(grant, query)).toBe(false);
  });

  it('should handle multi-field grants', () => {
    const grant = createCapabilitySubject({
      packageId: 'pkg',
      appId: 'foo',
      workspaceId: 'ws-1',
    });
    const query = createCapabilitySubject({
      packageId: 'pkg',
      appId: 'foo',
      workspaceId: 'ws-1',
      instanceId: 'inst-1',
    });
    expect(subjectMatches(grant, query)).toBe(true);
  });

  it('should not match multi-field grant with one mismatch', () => {
    const grant = createCapabilitySubject({
      packageId: 'pkg',
      appId: 'foo',
      workspaceId: 'ws-1',
    });
    const query = createCapabilitySubject({
      packageId: 'pkg',
      appId: 'foo',
      workspaceId: 'ws-2',
    });
    expect(subjectMatches(grant, query)).toBe(false);
  });
});

describe('isNarrowedBy', () => {
  it('should return true when narrower adds a field', () => {
    const broader = createCapabilitySubject({ appId: 'foo' });
    const narrower = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(isNarrowedBy(broader, narrower)).toBe(true);
  });

  it('should return false when subjects are equal', () => {
    const a = createCapabilitySubject({ appId: 'foo' });
    const b = createCapabilitySubject({ appId: 'foo' });
    expect(isNarrowedBy(a, b)).toBe(false);
  });

  it('should return false when narrower misses a broader field', () => {
    const broader = createCapabilitySubject({ appId: 'foo', workspaceId: 'ws-1' });
    const narrower = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    // narrower doesn't have workspaceId, so it's not a strict narrowing
    expect(isNarrowedBy(broader, narrower)).toBe(false);
  });

  it('should return false when narrower changes a broader field value', () => {
    const broader = createCapabilitySubject({ appId: 'foo' });
    const narrower = createCapabilitySubject({ appId: 'bar', instanceId: '123' });
    expect(isNarrowedBy(broader, narrower)).toBe(false);
  });

  it('should return true for multi-level narrowing', () => {
    const broader = createCapabilitySubject({ packageId: 'pkg' });
    const narrower = createCapabilitySubject({
      packageId: 'pkg',
      appId: 'foo',
      instanceId: '123',
    });
    expect(isNarrowedBy(broader, narrower)).toBe(true);
  });

  it('should return false for empty broader and empty narrower', () => {
    const broader = createCapabilitySubject({});
    const narrower = createCapabilitySubject({});
    expect(isNarrowedBy(broader, narrower)).toBe(false);
  });

  it('should return true for empty broader and non-empty narrower', () => {
    const broader = createCapabilitySubject({});
    const narrower = createCapabilitySubject({ appId: 'foo' });
    expect(isNarrowedBy(broader, narrower)).toBe(true);
  });
});

describe('subjectSpecificity', () => {
  it('should return 0 for empty subject', () => {
    expect(subjectSpecificity(createCapabilitySubject({}))).toBe(0);
  });

  it('should count set fields', () => {
    expect(
      subjectSpecificity(
        createCapabilitySubject({ appId: 'foo', instanceId: '123', workspaceId: 'ws-1' }),
      ),
    ).toBe(3);
  });
});

describe('subjectsEqual', () => {
  it('should return true for equal subjects', () => {
    const a = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    const b = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectsEqual(a, b)).toBe(true);
  });

  it('should return false for different subjects', () => {
    const a = createCapabilitySubject({ appId: 'foo' });
    const b = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectsEqual(a, b)).toBe(false);
  });
});

describe('subjectKey', () => {
  it('should produce deterministic keys', () => {
    const a = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    const b = createCapabilitySubject({ appId: 'foo', instanceId: '123' });
    expect(subjectKey(a)).toBe(subjectKey(b));
  });

  it('should produce different keys for different subjects', () => {
    const a = createCapabilitySubject({ appId: 'foo' });
    const b = createCapabilitySubject({ appId: 'bar' });
    expect(subjectKey(a)).not.toBe(subjectKey(b));
  });

  it('should produce empty string for empty subject', () => {
    expect(subjectKey(createCapabilitySubject({}))).toBe('');
  });
});
