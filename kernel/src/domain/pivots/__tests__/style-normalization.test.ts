import { pivotStyleIdForCompute, publicPivotStyleId } from '../style-normalization';

describe('pivot style normalization', () => {
  it('canonicalizes built-in full and short pivot style IDs', () => {
    expect(pivotStyleIdForCompute('PivotStyleLight16')).toBe('PivotStyleLight16');
    expect(pivotStyleIdForCompute('light16')).toBe('PivotStyleLight16');
    expect(pivotStyleIdForCompute('pivotstylemedium04')).toBe('PivotStyleMedium4');
  });

  it('preserves custom pivot style IDs', () => {
    expect(pivotStyleIdForCompute('MyPivotStyle')).toBe('MyPivotStyle');
    expect(publicPivotStyleId('MyPivotStyle')).toBe('MyPivotStyle');
  });
});
