export function pointsToCanvasPx(sizePt: number | undefined): number | undefined {
  return sizePt === undefined ? undefined : sizePt * 2;
}

export function linePointsToCanvasPx(widthPt: number | undefined): number | undefined {
  return widthPt === undefined ? undefined : Math.max(1, widthPt * 2);
}
