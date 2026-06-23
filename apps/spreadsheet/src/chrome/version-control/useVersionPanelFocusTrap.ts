import { useEffect, type RefObject } from 'react';

export function useVersionPanelFocusTrap(panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusableElements = getFocusablePanelElements(panel);
      if (focusableElements.length === 0) return;

      const activeElement = document.activeElement;
      const activeIndex =
        activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;

      if (activeIndex === -1) {
        if (!shouldRouteAmbientFocusIntoPanel(activeElement)) return;
        event.preventDefault();
        focusableElements[event.shiftKey ? focusableElements.length - 1 : 0]?.focus({
          preventScroll: true,
        });
        return;
      }

      if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        focusableElements[focusableElements.length - 1]?.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeIndex === focusableElements.length - 1) {
        event.preventDefault();
        focusableElements[0]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [panelRef]);
}

function shouldRouteAmbientFocusIntoPanel(activeElement: Element | null): boolean {
  if (!activeElement || activeElement === document.body) return true;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (activeElement.closest('[data-spreadsheet-grid-root], [data-grid-root], [role="grid"]')) {
    return true;
  }
  return activeElement.tabIndex < 0 && activeElement.getAttribute('role') !== 'button';
}

function getFocusablePanelElements(panel: HTMLElement): HTMLElement[] {
  const selectors = [
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(panel.querySelectorAll<HTMLElement>(selectors)).filter(isFocusableElement);
}

function isFocusableElement(element: HTMLElement): boolean {
  if (element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return element.getClientRects().length > 0;
}
