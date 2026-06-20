import { CANVAS_PIXELS_PER_POINT } from '../../defaults';

export function pointsToCanvasPx(sizePt: number | undefined): number | undefined {
  return sizePt === undefined || sizePt <= 0 ? undefined : sizePt * CANVAS_PIXELS_PER_POINT;
}

export function linePointsToCanvasPx(widthPt: number | undefined): number | undefined {
  return widthPt === undefined ? undefined : Math.max(1, widthPt * CANVAS_PIXELS_PER_POINT);
}
