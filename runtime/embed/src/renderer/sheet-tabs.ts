// Inlined constants (previously in deleted ./constants.ts)
const SHEET_TAB_HEIGHT = 32;
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, sans-serif';

/** Sheet info accepted by the tab bar. */
export interface SheetTabInfo {
  name: string;
  index: number;
}

/**
 * SheetTabs — DOM component for the sheet tab bar.
 * Uses event delegation instead of per-tab listeners.
 */
export class SheetTabs {
  private _el: HTMLDivElement;
  private _onSelect: ((index: number) => void) | null = null;

  constructor(container: HTMLElement, theme: { gridlineColor: string; headerBg: string }) {
    this._el = document.createElement('div');
    this._el.style.cssText = `
      display: flex;
      height: ${SHEET_TAB_HEIGHT}px;
      background: ${theme.headerBg};
      border-top: 1px solid ${theme.gridlineColor};
      overflow-x: auto;
      font-family: ${SYSTEM_FONT};
      font-size: 12px;
    `;

    // Event delegation — single listener on the container
    this._el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-sheet-index]') as HTMLElement | null;
      if (target && this._onSelect) {
        this._onSelect(Number(target.dataset.sheetIndex));
      }
    });

    container.appendChild(this._el);
  }

  update(sheets: SheetTabInfo[], activeIndex: number, onSelect: (index: number) => void): void {
    this._onSelect = onSelect;
    this._el.innerHTML = '';

    for (const sheet of sheets) {
      const tab = document.createElement('div');
      tab.dataset.sheetIndex = String(sheet.index);
      tab.textContent = sheet.name;
      const isActive = sheet.index === activeIndex;
      tab.style.cssText = `
        padding: 0 16px;
        line-height: ${SHEET_TAB_HEIGHT}px;
        cursor: pointer;
        white-space: nowrap;
        border-right: 1px solid ${this._el.style.borderTopColor || '#E2E2E2'};
        background: ${isActive ? '#FFFFFF' : 'transparent'};
        font-weight: ${isActive ? '600' : '400'};
        color: ${isActive ? '#333' : '#666'};
      `;
      this._el.appendChild(tab);
    }
  }

  dispose(): void {
    this._el.remove();
  }
}

export { SHEET_TAB_HEIGHT };
