type RectLike = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

type ViewportSize = {
  readonly width: number;
  readonly height: number;
};

type ContainingBlockRect = {
  readonly left: number;
  readonly top: number;
};

export type SubmenuPanelPosition = {
  readonly left: number;
  readonly top: number;
};

const SUBMENU_PANEL_WIDTH_PX = 180;
const SUBMENU_PANEL_GAP_PX = 4;
const SUBMENU_PANEL_VIEWPORT_MARGIN_PX = 8;
const SUBMENU_PANEL_ESTIMATED_HEIGHT_PX = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function calculateSubmenuPanelPosition(
  triggerRect: RectLike,
  viewport: ViewportSize,
  containingBlockRect: ContainingBlockRect | null,
): SubmenuPanelPosition {
  const spaceRight = viewport.width - triggerRect.right;
  const spaceLeft = triggerRect.left;
  const preferredPlacement =
    spaceRight >= SUBMENU_PANEL_WIDTH_PX + SUBMENU_PANEL_GAP_PX || spaceRight >= spaceLeft
      ? 'right'
      : 'left';
  const preferredViewportLeft =
    preferredPlacement === 'right'
      ? triggerRect.right + SUBMENU_PANEL_GAP_PX
      : triggerRect.left - SUBMENU_PANEL_WIDTH_PX - SUBMENU_PANEL_GAP_PX;
  const maxViewportLeft =
    viewport.width - SUBMENU_PANEL_WIDTH_PX - SUBMENU_PANEL_VIEWPORT_MARGIN_PX;
  const maxViewportTop =
    viewport.height - SUBMENU_PANEL_ESTIMATED_HEIGHT_PX - SUBMENU_PANEL_VIEWPORT_MARGIN_PX;

  const viewportLeft = clamp(
    preferredViewportLeft,
    SUBMENU_PANEL_VIEWPORT_MARGIN_PX,
    Math.max(SUBMENU_PANEL_VIEWPORT_MARGIN_PX, maxViewportLeft),
  );
  const viewportTop = clamp(
    triggerRect.top,
    SUBMENU_PANEL_VIEWPORT_MARGIN_PX,
    Math.max(SUBMENU_PANEL_VIEWPORT_MARGIN_PX, maxViewportTop),
  );

  return {
    left: viewportLeft - (containingBlockRect?.left ?? 0),
    top: viewportTop - (containingBlockRect?.top ?? 0),
  };
}

function enabledCssValue(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized !== '' && normalized !== 'none' && normalized !== 'normal' && normalized !== 'auto';
}

function createsFixedContainingBlock(style: CSSStyleDeclaration): boolean {
  const styleWithModernFilters = style as CSSStyleDeclaration & {
    backdropFilter?: string;
    webkitBackdropFilter?: string;
  };
  const willChange = style.willChange.toLowerCase();
  const contain = style.contain.toLowerCase();
  return (
    enabledCssValue(style.transform) ||
    enabledCssValue(style.translate) ||
    enabledCssValue(style.scale) ||
    enabledCssValue(style.rotate) ||
    enabledCssValue(style.perspective) ||
    enabledCssValue(style.filter) ||
    enabledCssValue(styleWithModernFilters.backdropFilter) ||
    enabledCssValue(styleWithModernFilters.webkitBackdropFilter) ||
    willChange.includes('transform') ||
    willChange.includes('perspective') ||
    willChange.includes('filter') ||
    contain.includes('paint') ||
    contain.includes('layout') ||
    contain.includes('strict') ||
    contain.includes('content')
  );
}

export function fixedContainingBlockRect(triggerElement: HTMLElement | null): ContainingBlockRect | null {
  if (!triggerElement || typeof window === 'undefined') return null;

  for (
    let element = triggerElement.parentElement;
    element && element !== document.documentElement;
    element = element.parentElement
  ) {
    const style = window.getComputedStyle(element);
    if (createsFixedContainingBlock(style)) {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }
  }

  return null;
}
