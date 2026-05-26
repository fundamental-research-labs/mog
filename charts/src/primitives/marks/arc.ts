/**
 * Arc mark - for pie charts, doughnut charts, radial visualizations.
 *
 * Pure functions, no side effects outside canvas drawing.
 */

import type { ArcMark } from '../types';
import { applyStyle } from './rect';

/**
 * Create an arc mark.
 *
 * @param props - Arc properties (excluding type)
 * @returns Complete ArcMark
 */
export function createArc(props: Omit<ArcMark, 'type'>): ArcMark {
  return { type: 'arc', ...props };
}

/**
 * Render an arc mark to canvas.
 *
 * The arc is drawn centered at (mark.x, mark.y).
 * Angles are in radians, with 0 at 12 o'clock (top), increasing clockwise.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Arc mark to render
 */
export function renderArc(ctx: CanvasRenderingContext2D, mark: ArcMark): void {
  ctx.save();
  applyStyle(ctx, mark.style);

  // Convert from "0 at top, clockwise" to canvas angles
  // Canvas: 0 at right (3 o'clock), counterclockwise positive
  // We want: 0 at top (12 o'clock), clockwise positive
  // So we rotate by -90 degrees and negate the direction
  const canvasStartAngle = mark.startAngle - Math.PI / 2;
  const canvasEndAngle = mark.endAngle - Math.PI / 2;

  ctx.beginPath();

  if (mark.innerRadius > 0) {
    // Doughnut/ring shape - need to draw two arcs
    // Outer arc (clockwise)
    ctx.arc(mark.x, mark.y, mark.outerRadius, canvasStartAngle, canvasEndAngle, false);
    // Line to inner arc
    ctx.arc(mark.x, mark.y, mark.innerRadius, canvasEndAngle, canvasStartAngle, true);
    ctx.closePath();
  } else {
    // Pie slice - single arc with lines to center
    ctx.moveTo(mark.x, mark.y);
    ctx.arc(mark.x, mark.y, mark.outerRadius, canvasStartAngle, canvasEndAngle, false);
    ctx.closePath();
  }

  if (mark.style.fill) {
    ctx.fill();
  }
  if (mark.style.stroke) {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Get the centroid (center point) of an arc.
 * Useful for positioning labels.
 *
 * @param mark - Arc mark
 * @returns Centroid coordinates
 */
export function getArcCentroid(mark: ArcMark): { x: number; y: number } {
  const midAngle = (mark.startAngle + mark.endAngle) / 2;
  const midRadius = (mark.innerRadius + mark.outerRadius) / 2;

  // Convert from "0 at top, clockwise" to standard math angles
  const mathAngle = midAngle - Math.PI / 2;

  return {
    x: mark.x + Math.cos(mathAngle) * midRadius,
    y: mark.y + Math.sin(mathAngle) * midRadius,
  };
}

/**
 * Check if a point is inside an arc mark.
 *
 * @param mark - Arc mark
 * @param px - Point x coordinate
 * @param py - Point y coordinate
 * @returns True if point is inside the arc
 */
export function hitTestArc(mark: ArcMark, px: number, py: number): boolean {
  // Calculate distance from center
  const dx = px - mark.x;
  const dy = py - mark.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Check radial bounds
  if (distance < mark.innerRadius || distance > mark.outerRadius) {
    return false;
  }

  // Check if this is a full circle (or nearly full)
  const arcSpan = Math.abs(mark.endAngle - mark.startAngle);
  if (arcSpan >= 2 * Math.PI - 0.0001) {
    // Full circle - any angle is valid
    return true;
  }

  // Calculate angle of point (in our coordinate system: 0 at top, clockwise)
  // atan2 gives us angle where 0 is right, counterclockwise positive
  // We need to convert to our system (0 at top, clockwise)
  let angle = Math.atan2(dy, dx) + Math.PI / 2;

  // Normalize to [0, 2*PI)
  while (angle < 0) {
    angle += 2 * Math.PI;
  }
  angle = angle % (2 * Math.PI);

  // Normalize start and end angles to [0, 2*PI)
  let startAngle = mark.startAngle;
  let endAngle = mark.endAngle;

  while (startAngle < 0) startAngle += 2 * Math.PI;
  while (endAngle < 0) endAngle += 2 * Math.PI;
  startAngle = startAngle % (2 * Math.PI);
  endAngle = endAngle % (2 * Math.PI);

  // Check if angle is within the arc's angular bounds
  if (startAngle <= endAngle) {
    return angle >= startAngle && angle <= endAngle;
  } else {
    // Arc wraps around 0
    return angle >= startAngle || angle <= endAngle;
  }
}

/**
 * Create arc marks for a pie/doughnut chart from values.
 *
 * @param values - Array of numeric values
 * @param centerX - Center x coordinate
 * @param centerY - Center y coordinate
 * @param outerRadius - Outer radius
 * @param innerRadius - Inner radius (0 for pie, > 0 for doughnut)
 * @param colors - Array of fill colors
 * @param data - Optional data array for datum property
 * @returns Array of arc marks
 */
export function createPieArcs(
  values: number[],
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number = 0,
  colors: string[] = [],
  data?: unknown[],
): ArcMark[] {
  const total = values.reduce((sum, v) => sum + Math.abs(v), 0);
  if (total === 0) return [];

  const arcs: ArcMark[] = [];
  let currentAngle = 0;

  const defaultColors = [
    '#4e79a7',
    '#f28e2c',
    '#e15759',
    '#76b7b2',
    '#59a14f',
    '#edc949',
    '#af7aa1',
    '#ff9da7',
    '#9c755f',
    '#bab0ab',
  ];

  for (let i = 0; i < values.length; i++) {
    const value = Math.abs(values[i]);
    const angleSpan = (value / total) * 2 * Math.PI;

    const arc = createArc({
      x: centerX,
      y: centerY,
      innerRadius,
      outerRadius,
      startAngle: currentAngle,
      endAngle: currentAngle + angleSpan,
      datum: data ? data[i] : { value: values[i], index: i },
      style: {
        fill: colors[i % colors.length] || defaultColors[i % defaultColors.length],
        stroke: '#ffffff',
        strokeWidth: 1,
      },
    });

    arcs.push(arc);
    currentAngle += angleSpan;
  }

  return arcs;
}
