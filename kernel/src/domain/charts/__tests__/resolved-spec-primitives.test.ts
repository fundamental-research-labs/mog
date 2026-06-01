import {
  defaultExportOptionsForSize,
  hashJson,
  snapshotScalar,
} from '../bridge/resolved-spec-primitives';

describe('resolved spec primitive helpers', () => {
  it('builds default export options from requested dimensions', () => {
    expect(defaultExportOptionsForSize(320.4, 179.6)).toEqual({
      format: 'png',
      width: 320.4,
      height: 179.6,
      pixelRatio: 1,
      physicalWidth: 320,
      physicalHeight: 180,
      backgroundColor: '#ffffff',
    });
    expect(defaultExportOptionsForSize(0, -5)).toMatchObject({
      physicalWidth: 1,
      physicalHeight: 1,
    });
  });

  it('snapshots scalar values for resolved specs', () => {
    expect(snapshotScalar('Jan')).toBe('Jan');
    expect(snapshotScalar(12.5)).toBe(12.5);
    expect(snapshotScalar(null)).toBeNull();
    expect(snapshotScalar(undefined)).toBeNull();
    expect(snapshotScalar(Number.NaN)).toBeNull();
    expect(snapshotScalar(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('hashes JSON with stable object keys and the existing algorithm', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe('5314055b31ce6b9c');
    expect(hashJson({ a: 1, b: 2 })).toBe('5314055b31ce6b9c');
    expect(hashJson({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('omits undefined object values and preserves array ordering', () => {
    expect(hashJson({ a: 1, b: undefined, c: null })).toBe('6f17e2d3c87b0f63');
    expect(hashJson({ a: 1, c: null })).toBe('6f17e2d3c87b0f63');
    expect(hashJson(['a', 'b'])).toBe('e0671ac858e10a23');
    expect(hashJson(['b', 'a'])).toBe('afa730004f2bb5bb');
  });

  it('hashes nested objects and arrays deterministically', () => {
    expect(hashJson({ z: [{ b: 2, a: 1 }, 'x'], a: true })).toBe('103dca6c0ad0fb6a');
  });
});
