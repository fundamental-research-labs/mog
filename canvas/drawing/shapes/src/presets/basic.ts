/**
 * Custom shape presets (no OOXML equivalent).
 *
 * circle, pill, curve, lineArrow, lineDoubleArrow, banner
 *
 * All OOXML preset shapes are registered by spec-presets.ts.
 */
import { PathOps } from '@mog/geometry';
import { KAPPA } from './constants';
import { ellipsePath } from './primitives';
import {
  getAdjustmentValue,
  registerCategory,
  registerNaturalRatio,
  registerPreset,
  registerUnfilled,
} from './registry';

export { ellipsePoint, regularPolygon, starPath } from './primitives';
export { ellipsePath };

registerCategory('Custom');

// ─── Circle ─────────────────────────────────────────────────────────────────

registerPreset('circle', (w, h) => ellipsePath(w / 2, h / 2, w / 2, h / 2));
registerNaturalRatio('circle', 1, true);

// ─── Pill ───────────────────────────────────────────────────────────────────

registerPreset('pill', (w, h) => {
  const r = Math.min(w / 2, h / 2);
  const b = PathOps.createPath();
  b.moveTo(r, 0);
  b.lineTo(w - r, 0);
  b.curveTo(w - r + r * KAPPA, 0, w, r - r * KAPPA, w, r);
  if (h > w) {
    b.lineTo(w, h - r);
  }
  b.curveTo(w, h - r + r * KAPPA, w - r + r * KAPPA, h, w - r, h);
  b.lineTo(r, h);
  b.curveTo(r - r * KAPPA, h, 0, h - r + r * KAPPA, 0, h - r);
  if (h > w) {
    b.lineTo(0, r);
  }
  b.curveTo(0, r - r * KAPPA, r - r * KAPPA, 0, r, 0);
  b.closePath();
  return b.toPath();
});
registerNaturalRatio('pill', 1.5);

// ─── Line Arrow ─────────────────────────────────────────────────────────────

registerPreset('lineArrow', (w, h) => {
  const b = PathOps.createPath();
  b.moveTo(0, 0).lineTo(w, h);
  const headSize = Math.min(w, h) * 0.15;
  const angle = Math.atan2(h, w);
  b.moveTo(w, h);
  b.lineTo(
    w - headSize * Math.cos(angle - Math.PI / 6),
    h - headSize * Math.sin(angle - Math.PI / 6),
  );
  b.moveTo(w, h);
  b.lineTo(
    w - headSize * Math.cos(angle + Math.PI / 6),
    h - headSize * Math.sin(angle + Math.PI / 6),
  );
  return b.toPath();
});
registerUnfilled('lineArrow');

// ─── Line Double Arrow ──────────────────────────────────────────────────────

registerPreset('lineDoubleArrow', (w, h) => {
  const b = PathOps.createPath();
  b.moveTo(0, 0).lineTo(w, h);
  const headSize = Math.min(w, h) * 0.15;
  const angle = Math.atan2(h, w);
  b.moveTo(w, h);
  b.lineTo(
    w - headSize * Math.cos(angle - Math.PI / 6),
    h - headSize * Math.sin(angle - Math.PI / 6),
  );
  b.moveTo(w, h);
  b.lineTo(
    w - headSize * Math.cos(angle + Math.PI / 6),
    h - headSize * Math.sin(angle + Math.PI / 6),
  );
  const rAngle = angle + Math.PI;
  b.moveTo(0, 0);
  b.lineTo(-headSize * Math.cos(rAngle - Math.PI / 6), -headSize * Math.sin(rAngle - Math.PI / 6));
  b.moveTo(0, 0);
  b.lineTo(-headSize * Math.cos(rAngle + Math.PI / 6), -headSize * Math.sin(rAngle + Math.PI / 6));
  return b.toPath();
});
registerUnfilled('lineDoubleArrow');

// ─── Curve ──────────────────────────────────────────────────────────────────

registerPreset('curve', (w, h) => {
  const b = PathOps.createPath();
  b.moveTo(0, h);
  b.curveTo(w * 0.33, 0, w * 0.66, 0, w, h);
  return b.toPath();
});
registerUnfilled('curve');

// ─── Banner ─────────────────────────────────────────────────────────────────

registerPreset(
  'banner',
  (w, h, adj) => {
    const f = getAdjustmentValue(adj, 'adjust', 0.1, 0.01, 0.5);
    const fold = f * h;
    const b = PathOps.createPath();
    b.moveTo(0, 0)
      .lineTo(w, 0)
      .lineTo(w, h - fold)
      .lineTo(w * 0.5, h)
      .lineTo(0, h - fold)
      .closePath();
    return b.toPath();
  },
  [{ name: 'adjust', value: 0.1, min: 0.01, max: 0.5 }],
);
registerNaturalRatio('banner', 2.5);
