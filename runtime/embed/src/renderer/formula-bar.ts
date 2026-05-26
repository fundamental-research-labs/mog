import { cellRef } from '../shared/column-name';

// Inlined constants (previously in deleted ./constants.ts)
const FORMULA_BAR_HEIGHT = 32;
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, sans-serif';

/** Cell info accepted by the formula bar. */
export interface FormulaBarCellInfo {
  ref: string;
  formula: string;
}

/**
 * FormulaBar — DOM component showing cell reference and formula/value.
 */
export class FormulaBar {
  private _el: HTMLDivElement;
  private _refEl: HTMLSpanElement;
  private _textEl: HTMLSpanElement;

  constructor(container: HTMLElement) {
    this._el = document.createElement('div');
    this._el.style.cssText = `
      display: flex;
      align-items: center;
      height: ${FORMULA_BAR_HEIGHT}px;
      box-sizing: border-box;
      background: #FFFFFF;
      border-bottom: 1px solid #E0E0E0;
      font-family: ${SYSTEM_FONT};
      font-size: 13px;
      color: #333;
      overflow: hidden;
    `;

    // Cell reference box
    const refBox = document.createElement('div');
    refBox.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      min-width: 80px;
      height: 100%;
      box-sizing: border-box;
      border-right: 1px solid #E0E0E0;
      font-weight: bold;
      color: #333;
    `;
    this._refEl = document.createElement('span');
    this._refEl.textContent = '';
    refBox.appendChild(this._refEl);
    this._el.appendChild(refBox);

    // Formula/value text
    const textBox = document.createElement('div');
    textBox.style.cssText = `
      flex: 1;
      padding: 0 8px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: #333;
    `;
    this._textEl = document.createElement('span');
    this._textEl.textContent = '';
    textBox.appendChild(this._textEl);
    this._el.appendChild(textBox);

    container.appendChild(this._el);
  }

  setRef(row: number, col: number): void {
    this._refEl.textContent = cellRef(row, col);
    this._textEl.textContent = ''; // clear until fresh data arrives
  }

  setCellInfo(info: FormulaBarCellInfo): void {
    this._refEl.textContent = info.ref;
    this._textEl.textContent = info.formula;
  }

  dispose(): void {
    this._el.remove();
  }
}

export { FORMULA_BAR_HEIGHT };
