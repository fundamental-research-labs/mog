/**
 * Path mark - for lines, areas, complex shapes.
 *
 * Uses SVG path d attribute format for maximum flexibility.
 * Pure functions, no side effects outside canvas drawing.
 */

import type { PathMark } from '../types';
import { applyStyle } from './rect';

/**
 * SVG path command types.
 */
export type PathCommand =
  | { type: 'M'; x: number; y: number } // MoveTo
  | { type: 'L'; x: number; y: number } // LineTo
  | { type: 'H'; x: number } // Horizontal line
  | { type: 'V'; y: number } // Vertical line
  | {
      type: 'C';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    } // Cubic bezier
  | { type: 'S'; x2: number; y2: number; x: number; y: number } // Smooth cubic
  | { type: 'Q'; x1: number; y1: number; x: number; y: number } // Quadratic bezier
  | { type: 'T'; x: number; y: number } // Smooth quadratic
  | {
      type: 'A';
      rx: number;
      ry: number;
      angle: number;
      largeArc: boolean;
      sweep: boolean;
      x: number;
      y: number;
    } // Arc
  | { type: 'Z' }; // Close path

/**
 * Parse an SVG path d attribute string into commands.
 * Supports absolute commands: M, L, H, V, C, S, Q, T, A, Z
 * Also supports lowercase (relative) commands.
 */
export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  // Match command letter followed by numbers (including negative and decimals)
  const regex = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match;
  let currentX = 0;
  let currentY = 0;

  while ((match = regex.exec(d)) !== null) {
    const cmd = match[1];
    const argsStr = match[2].trim();
    const args = argsStr ? argsStr.split(/[\s,]+/).map((s) => parseFloat(s)) : [];
    const isRelative = cmd === cmd.toLowerCase();
    const cmdUpper = cmd.toUpperCase();

    switch (cmdUpper) {
      case 'M': {
        const x = isRelative ? currentX + args[0] : args[0];
        const y = isRelative ? currentY + args[1] : args[1];
        commands.push({ type: 'M', x, y });
        currentX = x;
        currentY = y;
        // Additional coordinate pairs are treated as lineTo
        for (let i = 2; i < args.length; i += 2) {
          const lx = isRelative ? currentX + args[i] : args[i];
          const ly = isRelative ? currentY + args[i + 1] : args[i + 1];
          commands.push({ type: 'L', x: lx, y: ly });
          currentX = lx;
          currentY = ly;
        }
        break;
      }
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          const x = isRelative ? currentX + args[i] : args[i];
          const y = isRelative ? currentY + args[i + 1] : args[i + 1];
          commands.push({ type: 'L', x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'H': {
        for (const arg of args) {
          const x = isRelative ? currentX + arg : arg;
          commands.push({ type: 'H', x });
          currentX = x;
        }
        break;
      }
      case 'V': {
        for (const arg of args) {
          const y = isRelative ? currentY + arg : arg;
          commands.push({ type: 'V', y });
          currentY = y;
        }
        break;
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const x1 = isRelative ? currentX + args[i] : args[i];
          const y1 = isRelative ? currentY + args[i + 1] : args[i + 1];
          const x2 = isRelative ? currentX + args[i + 2] : args[i + 2];
          const y2 = isRelative ? currentY + args[i + 3] : args[i + 3];
          const x = isRelative ? currentX + args[i + 4] : args[i + 4];
          const y = isRelative ? currentY + args[i + 5] : args[i + 5];
          commands.push({ type: 'C', x1, y1, x2, y2, x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'S': {
        for (let i = 0; i < args.length; i += 4) {
          const x2 = isRelative ? currentX + args[i] : args[i];
          const y2 = isRelative ? currentY + args[i + 1] : args[i + 1];
          const x = isRelative ? currentX + args[i + 2] : args[i + 2];
          const y = isRelative ? currentY + args[i + 3] : args[i + 3];
          commands.push({ type: 'S', x2, y2, x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'Q': {
        for (let i = 0; i < args.length; i += 4) {
          const x1 = isRelative ? currentX + args[i] : args[i];
          const y1 = isRelative ? currentY + args[i + 1] : args[i + 1];
          const x = isRelative ? currentX + args[i + 2] : args[i + 2];
          const y = isRelative ? currentY + args[i + 3] : args[i + 3];
          commands.push({ type: 'Q', x1, y1, x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'T': {
        for (let i = 0; i < args.length; i += 2) {
          const x = isRelative ? currentX + args[i] : args[i];
          const y = isRelative ? currentY + args[i + 1] : args[i + 1];
          commands.push({ type: 'T', x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'A': {
        for (let i = 0; i < args.length; i += 7) {
          const rx = args[i];
          const ry = args[i + 1];
          const angle = args[i + 2];
          const largeArc = args[i + 3] === 1;
          const sweep = args[i + 4] === 1;
          const x = isRelative ? currentX + args[i + 5] : args[i + 5];
          const y = isRelative ? currentY + args[i + 6] : args[i + 6];
          commands.push({ type: 'A', rx, ry, angle, largeArc, sweep, x, y });
          currentX = x;
          currentY = y;
        }
        break;
      }
      case 'Z': {
        commands.push({ type: 'Z' });
        break;
      }
    }
  }

  return commands;
}

/**
 * Convert endpoint arc parameters to center arc parameters for canvas.
 */
export function arcEndpointToCenter(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): { cx: number; cy: number; theta1: number; dtheta: number } | null {
  // Handle degenerate cases
  if (rx === 0 || ry === 0) return null;

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phiRad = (phi * Math.PI) / 180;

  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;

  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
    lambda = 1;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  let sq = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq);
  sq = Math.max(0, sq);
  const coef = sign * Math.sqrt(sq);

  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let dtheta = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - theta1;

  if (!sweep && dtheta > 0) {
    dtheta -= 2 * Math.PI;
  } else if (sweep && dtheta < 0) {
    dtheta += 2 * Math.PI;
  }

  return { cx, cy, theta1, dtheta };
}

/**
 * Apply path commands to canvas context.
 */
export function applyPathCommands(
  ctx: CanvasRenderingContext2D,
  commands: PathCommand[],
  offsetX: number,
  offsetY: number,
): void {
  let currentX = 0;
  let currentY = 0;
  let lastCx = 0; // Last control point for smooth curves
  let lastCy = 0;
  let lastCmd: string | null = null;

  ctx.beginPath();

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        ctx.moveTo(cmd.x + offsetX, cmd.y + offsetY);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'L':
        ctx.lineTo(cmd.x + offsetX, cmd.y + offsetY);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'H':
        ctx.lineTo(cmd.x + offsetX, currentY + offsetY);
        currentX = cmd.x;
        break;
      case 'V':
        ctx.lineTo(currentX + offsetX, cmd.y + offsetY);
        currentY = cmd.y;
        break;
      case 'C':
        ctx.bezierCurveTo(
          cmd.x1 + offsetX,
          cmd.y1 + offsetY,
          cmd.x2 + offsetX,
          cmd.y2 + offsetY,
          cmd.x + offsetX,
          cmd.y + offsetY,
        );
        lastCx = cmd.x2;
        lastCy = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'S': {
        // Smooth cubic: control point reflected from previous
        let cx1 = currentX;
        let cy1 = currentY;
        if (lastCmd === 'C' || lastCmd === 'S') {
          cx1 = 2 * currentX - lastCx;
          cy1 = 2 * currentY - lastCy;
        }
        ctx.bezierCurveTo(
          cx1 + offsetX,
          cy1 + offsetY,
          cmd.x2 + offsetX,
          cmd.y2 + offsetY,
          cmd.x + offsetX,
          cmd.y + offsetY,
        );
        lastCx = cmd.x2;
        lastCy = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Q':
        ctx.quadraticCurveTo(cmd.x1 + offsetX, cmd.y1 + offsetY, cmd.x + offsetX, cmd.y + offsetY);
        lastCx = cmd.x1;
        lastCy = cmd.y1;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'T': {
        // Smooth quadratic: control point reflected from previous
        let qx1 = currentX;
        let qy1 = currentY;
        if (lastCmd === 'Q' || lastCmd === 'T') {
          qx1 = 2 * currentX - lastCx;
          qy1 = 2 * currentY - lastCy;
        }
        ctx.quadraticCurveTo(qx1 + offsetX, qy1 + offsetY, cmd.x + offsetX, cmd.y + offsetY);
        lastCx = qx1;
        lastCy = qy1;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'A': {
        // Convert SVG arc to canvas arc
        const arc = arcEndpointToCenter(
          currentX,
          currentY,
          cmd.rx,
          cmd.ry,
          cmd.angle,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        );
        if (arc) {
          // For non-uniform radii, we need to use ellipse
          if (cmd.rx !== cmd.ry) {
            ctx.ellipse(
              arc.cx + offsetX,
              arc.cy + offsetY,
              cmd.rx,
              cmd.ry,
              (cmd.angle * Math.PI) / 180,
              arc.theta1,
              arc.theta1 + arc.dtheta,
              arc.dtheta < 0,
            );
          } else {
            ctx.arc(
              arc.cx + offsetX,
              arc.cy + offsetY,
              cmd.rx,
              arc.theta1,
              arc.theta1 + arc.dtheta,
              arc.dtheta < 0,
            );
          }
        } else {
          // Degenerate arc: draw line
          ctx.lineTo(cmd.x + offsetX, cmd.y + offsetY);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Z':
        ctx.closePath();
        break;
    }
    lastCmd = cmd.type;
  }
}

/**
 * Create a path mark.
 *
 * @param props - Path properties (excluding type)
 * @returns Complete PathMark
 */
export function createPath(props: Omit<PathMark, 'type'>): PathMark {
  return { type: 'path', ...props };
}

/**
 * Render a path mark to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Path mark to render
 */
export function renderPath(ctx: CanvasRenderingContext2D, mark: PathMark): void {
  ctx.save();
  applyStyle(ctx, mark.style);

  const commands = parsePath(mark.path);
  applyPathCommands(ctx, commands, mark.x, mark.y);

  if (mark.style.fill) {
    ctx.fill();
  }
  if (mark.style.stroke) {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Helper to create a line path from points.
 *
 * @param points - Array of [x, y] coordinates
 * @returns SVG path d string
 */
export function linePathFromPoints(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i][0]},${points[i][1]}`;
  }
  return d;
}

/**
 * Helper to create a closed area path from points.
 *
 * @param points - Array of [x, y] coordinates for top edge
 * @param baseline - Y coordinate for baseline (bottom of area)
 * @returns SVG path d string
 */
export function areaPathFromPoints(points: [number, number][], baseline: number): string {
  if (points.length === 0) return '';

  let d = `M${points[0][0]},${baseline}`;
  d += ` L${points[0][0]},${points[0][1]}`;

  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i][0]},${points[i][1]}`;
  }

  d += ` L${points[points.length - 1][0]},${baseline}`;
  d += ' Z';

  return d;
}
