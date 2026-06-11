import { WINDOW_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';

describe('View ribbon responsive layout', () => {
  test('keeps Window commands mounted at dense desktop widths', () => {
    expect(WINDOW_COLLAPSE_CONFIG.levels[2]).toBe('icons');
    expect(WINDOW_COLLAPSE_CONFIG.levels[3]).toBe('dropdown');
  });
});
