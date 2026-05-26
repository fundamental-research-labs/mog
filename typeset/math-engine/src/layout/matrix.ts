/**
 * Matrix Layout
 *
 * Computes layout for matrix nodes (m:m).
 * Grid layout with aligned columns and rows.
 */

import type { MatrixNode } from '@mog-sdk/contracts/equation/omml-ast';
import { arrangeHorizontally, type LayoutBox, type LayoutConfig } from './types';

export function layoutMatrix(node: MatrixNode, config: LayoutConfig): LayoutBox {
  const layoutNodes = config.layoutNodes!;
  if (node.mr.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      baseline: 0,
      fontSize: config.fontSize,
      children: [],
      node,
    };
  }

  // Layout each cell
  const cellBoxes: { width: number; height: number; baseline: number; children: LayoutBox[] }[][] =
    [];
  for (const row of node.mr) {
    // Each row is MathNode[][] - an array of cells, each cell is MathNode[]
    const rowCells: { width: number; height: number; baseline: number; children: LayoutBox[] }[] =
      [];
    for (const cell of row) {
      const cellChildren = layoutNodes(cell, config);
      const cellBox = arrangeHorizontally(cellChildren, config.style);
      rowCells.push(cellBox);
    }
    cellBoxes.push(rowCells);
  }

  // Determine column widths and row heights
  const numCols = Math.max(...cellBoxes.map((row) => row.length));
  const colWidths: number[] = new Array(numCols).fill(0);
  const rowHeights: number[] = [];
  const rowBaselines: number[] = [];

  for (let r = 0; r < cellBoxes.length; r++) {
    let maxHeight = 0;
    let maxBaseline = 0;
    for (let c = 0; c < cellBoxes[r].length; c++) {
      const cell = cellBoxes[r][c];
      colWidths[c] = Math.max(colWidths[c], cell.width);
      maxHeight = Math.max(maxHeight, cell.height);
      maxBaseline = Math.max(maxBaseline, cell.baseline);
    }
    rowHeights.push(maxHeight);
    rowBaselines.push(maxBaseline);
  }

  // Arrange cells in grid
  const colGap = config.matrixColGap;
  const rowGap = config.matrixRowGap;

  const allChildren: LayoutBox[] = [];
  let yOffset = 0;

  for (let r = 0; r < cellBoxes.length; r++) {
    let xOffset = 0;
    for (let c = 0; c < cellBoxes[r].length; c++) {
      const cell = cellBoxes[r][c];
      const cellXOffset = xOffset + (colWidths[c] - cell.width) / 2;
      const cellYOffset = yOffset + (rowBaselines[r] - cell.baseline);

      for (const child of cell.children) {
        allChildren.push({
          ...child,
          x: child.x + cellXOffset,
          y: child.y + cellYOffset,
        });
      }
      xOffset += colWidths[c] + colGap;
    }
    yOffset += rowHeights[r] + rowGap;
  }

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (numCols - 1) * colGap;
  const totalHeight = yOffset > 0 ? yOffset - rowGap : 0;
  const baseline = totalHeight / 2; // Matrices are vertically centered

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: allChildren,
    node,
  };
}
