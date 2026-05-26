import { lookupAction } from '../key-action-map';

describe('lookupAction', () => {
  it('maps Shift+PageUp/PageDown to page extension actions', () => {
    expect(lookupAction('PageUp', { shift: true })).toBe('EXTEND_SELECTION_PAGE_UP');
    expect(lookupAction('PageDown', { shift: true })).toBe('EXTEND_SELECTION_PAGE_DOWN');
  });
});
