import { menuItemClasses, menuItemDestructiveClasses } from '../radix/styles';

describe('menuItemClasses', () => {
  it('includes hover:bg-ss-surface-hover fallback alongside data-[highlighted]', () => {
    expect(menuItemClasses).toContain('hover:bg-ss-surface-hover');
    expect(menuItemClasses).toContain('data-[highlighted]:bg-ss-surface-hover');
  });
});

describe('menuItemDestructiveClasses', () => {
  it('includes hover:bg-ss-error-bg fallback alongside data-[highlighted]', () => {
    expect(menuItemDestructiveClasses).toContain('hover:bg-ss-error-bg');
    expect(menuItemDestructiveClasses).toContain('data-[highlighted]:bg-ss-error-bg');
  });
});
