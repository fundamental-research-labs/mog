import { getDefaultAlignment, mapHorizontalAlign } from '../text';

describe('default horizontal alignment', () => {
  it('resolves General alignment from value type', () => {
    expect(getDefaultAlignment('Label')).toBe('left');
    expect(getDefaultAlignment(123)).toBe('right');
    expect(getDefaultAlignment(true)).toBe('center');
  });

  it('maps omitted and explicit General alignment from value type', () => {
    expect(mapHorizontalAlign(undefined, 'Label')).toBe('left');
    expect(mapHorizontalAlign('general', 123)).toBe('right');
    expect(mapHorizontalAlign('general', false)).toBe('center');
  });
});
