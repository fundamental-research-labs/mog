import { calculateSubmenuPanelPosition, fixedContainingBlockRect } from '../submenu-position';

describe('filter submenu positioning', () => {
  it('places a submenu to the right when there is viewport space', () => {
    expect(
      calculateSubmenuPanelPosition(
        { left: 100, right: 280, top: 120 },
        { width: 1000, height: 800 },
        null,
      ),
    ).toEqual({ left: 284, top: 120 });
  });

  it('flips left near the right viewport edge', () => {
    expect(
      calculateSubmenuPanelPosition(
        { left: 1110, right: 1388, top: 420.5 },
        { width: 1396, height: 900 },
        null,
      ),
    ).toEqual({ left: 926, top: 420.5 });
  });

  it('converts viewport coordinates into a transformed popover containing block', () => {
    expect(
      calculateSubmenuPanelPosition(
        { left: 1110, right: 1388, top: 420.5 },
        { width: 1396, height: 900 },
        { left: 1060, top: 260 },
      ),
    ).toEqual({ left: -134, top: 160.5 });
  });

  it('keeps tall date filter menus inside the viewport vertically', () => {
    expect(
      calculateSubmenuPanelPosition(
        { left: 400, right: 678, top: 760 },
        { width: 1200, height: 900 },
        null,
      ),
    ).toEqual({ left: 682, top: 492 });
  });

  it('finds the nearest transformed ancestor that contains fixed descendants', () => {
    const root = document.createElement('div');
    const popover = document.createElement('div');
    const trigger = document.createElement('button');

    popover.style.transform = 'translate(100px, 200px)';
    popover.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        right: 380,
        bottom: 800,
        width: 280,
        height: 600,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    root.appendChild(popover);
    popover.appendChild(trigger);
    document.body.appendChild(root);

    expect(fixedContainingBlockRect(trigger)).toEqual({ left: 100, top: 200 });

    root.remove();
  });
});
