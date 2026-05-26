/**
 * ChartVariantThumbnail
 *
 * SVG preview thumbnails for chart variants in the gallery dropdown.
 * Each thumbnail is a simplified visual representation of the chart type.
 *
 * Used by ChartGallery to show previews in the dropdown menu.
 *
 * @module components/charts/ChartVariantThumbnail
 */

import React from 'react';

// =============================================================================
// Types
// =============================================================================

export interface ChartVariantThumbnailProps {
  /** The variant ID to render */
  variantId: string;
  /** Size of the thumbnail (default 48) */
  size?: number;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Color palette for chart previews (matches Excel)
// =============================================================================

const CHART_COLORS = {
  primary: '#4472C4',
  secondary: '#ED7D31',
  tertiary: '#A5A5A5',
  quaternary: '#FFC000',
  axis: '#D0D0D0',
  background: 'var(--color-ss-surface-secondary)',
};

// =============================================================================
// Individual Chart Thumbnail Renderers
// =============================================================================

function ClusteredColumnThumbnail({ size }: { size: number }) {
  const barWidth = size * 0.12;
  const gap = size * 0.04;
  const groupGap = size * 0.1;
  const baseY = size * 0.85;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Axis line */}
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Group 1 */}
      <rect
        x={size * 0.15}
        y={size * 0.3}
        width={barWidth}
        height={size * 0.55}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + barWidth + gap}
        y={size * 0.45}
        width={barWidth}
        height={size * 0.4}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Group 2 */}
      <rect
        x={size * 0.15 + (barWidth + gap) * 2 + groupGap}
        y={size * 0.4}
        width={barWidth}
        height={size * 0.45}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + (barWidth + gap) * 3 + groupGap}
        y={size * 0.25}
        width={barWidth}
        height={size * 0.6}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Group 3 */}
      <rect
        x={size * 0.15 + (barWidth + gap) * 4 + groupGap * 2}
        y={size * 0.5}
        width={barWidth}
        height={size * 0.35}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + (barWidth + gap) * 5 + groupGap * 2}
        y={size * 0.35}
        width={barWidth}
        height={size * 0.5}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function StackedColumnThumbnail({ size }: { size: number }) {
  const barWidth = size * 0.18;
  const gap = size * 0.12;
  const baseY = size * 0.85;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Stack 1 */}
      <rect
        x={size * 0.15}
        y={size * 0.5}
        width={barWidth}
        height={size * 0.35}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15}
        y={size * 0.25}
        width={barWidth}
        height={size * 0.25}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Stack 2 */}
      <rect
        x={size * 0.15 + barWidth + gap}
        y={size * 0.4}
        width={barWidth}
        height={size * 0.45}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + barWidth + gap}
        y={size * 0.15}
        width={barWidth}
        height={size * 0.25}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Stack 3 */}
      <rect
        x={size * 0.15 + (barWidth + gap) * 2}
        y={size * 0.55}
        width={barWidth}
        height={size * 0.3}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + (barWidth + gap) * 2}
        y={size * 0.3}
        width={barWidth}
        height={size * 0.25}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function PercentStackedColumnThumbnail({ size }: { size: number }) {
  const barWidth = size * 0.18;
  const gap = size * 0.12;
  const baseY = size * 0.85;
  const totalHeight = size * 0.65;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Stack 1 - 60/40 */}
      <rect
        x={size * 0.15}
        y={baseY - totalHeight * 0.6}
        width={barWidth}
        height={totalHeight * 0.6}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15}
        y={baseY - totalHeight}
        width={barWidth}
        height={totalHeight * 0.4}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Stack 2 - 40/60 */}
      <rect
        x={size * 0.15 + barWidth + gap}
        y={baseY - totalHeight * 0.4}
        width={barWidth}
        height={totalHeight * 0.4}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + barWidth + gap}
        y={baseY - totalHeight}
        width={barWidth}
        height={totalHeight * 0.6}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Stack 3 - 50/50 */}
      <rect
        x={size * 0.15 + (barWidth + gap) * 2}
        y={baseY - totalHeight * 0.5}
        width={barWidth}
        height={totalHeight * 0.5}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + (barWidth + gap) * 2}
        y={baseY - totalHeight}
        width={barWidth}
        height={totalHeight * 0.5}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function ClusteredBarThumbnail({ size }: { size: number }) {
  const barHeight = size * 0.1;
  const gap = size * 0.03;
  const groupGap = size * 0.08;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.15}
        y1={size * 0.1}
        x2={size * 0.15}
        y2={size * 0.9}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Group 1 */}
      <rect
        x={size * 0.15}
        y={size * 0.15}
        width={size * 0.6}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15}
        y={size * 0.15 + barHeight + gap}
        width={size * 0.45}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Group 2 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 2 + groupGap}
        width={size * 0.5}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 3 + groupGap}
        width={size * 0.7}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Group 3 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 4 + groupGap * 2}
        width={size * 0.4}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 5 + groupGap * 2}
        width={size * 0.55}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function StackedBarThumbnail({ size }: { size: number }) {
  const barHeight = size * 0.15;
  const gap = size * 0.1;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.15}
        y1={size * 0.1}
        x2={size * 0.15}
        y2={size * 0.9}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Bar 1 */}
      <rect
        x={size * 0.15}
        y={size * 0.15}
        width={size * 0.4}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.55}
        y={size * 0.15}
        width={size * 0.25}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Bar 2 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + barHeight + gap}
        width={size * 0.5}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.65}
        y={size * 0.15 + barHeight + gap}
        width={size * 0.2}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Bar 3 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 2}
        width={size * 0.35}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.5}
        y={size * 0.15 + (barHeight + gap) * 2}
        width={size * 0.3}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function PercentStackedBarThumbnail({ size }: { size: number }) {
  const barHeight = size * 0.15;
  const gap = size * 0.1;
  const totalWidth = size * 0.7;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.15}
        y1={size * 0.1}
        x2={size * 0.15}
        y2={size * 0.9}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Bar 1 - 60/40 */}
      <rect
        x={size * 0.15}
        y={size * 0.15}
        width={totalWidth * 0.6}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + totalWidth * 0.6}
        y={size * 0.15}
        width={totalWidth * 0.4}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Bar 2 - 40/60 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + barHeight + gap}
        width={totalWidth * 0.4}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + totalWidth * 0.4}
        y={size * 0.15 + barHeight + gap}
        width={totalWidth * 0.6}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
      {/* Bar 3 - 50/50 */}
      <rect
        x={size * 0.15}
        y={size * 0.15 + (barHeight + gap) * 2}
        width={totalWidth * 0.5}
        height={barHeight}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.15 + totalWidth * 0.5}
        y={size * 0.15 + (barHeight + gap) * 2}
        width={totalWidth * 0.5}
        height={barHeight}
        fill={CHART_COLORS.secondary}
        rx={1}
      />
    </svg>
  );
}

function LineThumbnail({ size, smooth = false }: { size: number; smooth?: boolean }) {
  const points = [
    { x: size * 0.15, y: size * 0.6 },
    { x: size * 0.35, y: size * 0.35 },
    { x: size * 0.55, y: size * 0.5 },
    { x: size * 0.75, y: size * 0.25 },
    { x: size * 0.9, y: size * 0.4 },
  ];

  const pathD = smooth
    ? `M ${points[0].x} ${points[0].y} C ${points[0].x + 10} ${points[0].y}, ${points[1].x - 10} ${points[1].y}, ${points[1].x} ${points[1].y} S ${points[2].x - 5} ${points[2].y}, ${points[2].x} ${points[2].y} S ${points[3].x - 5} ${points[3].y}, ${points[3].x} ${points[3].y} S ${points[4].x - 5} ${points[4].y}, ${points[4].x} ${points[4].y}`
    : `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={size * 0.85}
        x2={size * 0.9}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <path d={pathD} fill="none" stroke={CHART_COLORS.primary} strokeWidth={2} />
    </svg>
  );
}

function LineWithMarkersThumbnail({ size }: { size: number }) {
  const points = [
    { x: size * 0.15, y: size * 0.6 },
    { x: size * 0.35, y: size * 0.35 },
    { x: size * 0.55, y: size * 0.5 },
    { x: size * 0.75, y: size * 0.25 },
    { x: size * 0.9, y: size * 0.4 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={size * 0.85}
        x2={size * 0.9}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <path
        d={`M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
        fill="none"
        stroke={CHART_COLORS.primary}
        strokeWidth={2}
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={CHART_COLORS.primary} />
      ))}
    </svg>
  );
}

function SteppedLineThumbnail({ size }: { size: number }) {
  const points = [
    { x: size * 0.15, y: size * 0.6 },
    { x: size * 0.35, y: size * 0.35 },
    { x: size * 0.55, y: size * 0.5 },
    { x: size * 0.75, y: size * 0.25 },
    { x: size * 0.9, y: size * 0.4 },
  ];

  // Build stepped path
  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` H ${points[i].x} V ${points[i].y}`;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={size * 0.85}
        x2={size * 0.9}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <path d={pathD} fill="none" stroke={CHART_COLORS.primary} strokeWidth={2} />
    </svg>
  );
}

function AreaThumbnail({ size, stacked = false }: { size: number; stacked?: boolean }) {
  const baseY = size * 0.85;
  const points1 = [
    { x: size * 0.1, y: size * 0.6 },
    { x: size * 0.3, y: size * 0.45 },
    { x: size * 0.5, y: size * 0.55 },
    { x: size * 0.7, y: size * 0.35 },
    { x: size * 0.9, y: size * 0.5 },
  ];

  const points2 = stacked
    ? [
        { x: size * 0.1, y: size * 0.4 },
        { x: size * 0.3, y: size * 0.25 },
        { x: size * 0.5, y: size * 0.35 },
        { x: size * 0.7, y: size * 0.15 },
        { x: size * 0.9, y: size * 0.3 },
      ]
    : [];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Area 1 */}
      <path
        d={`M ${points1[0].x} ${baseY} L ${points1.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${size * 0.9} ${baseY} Z`}
        fill={CHART_COLORS.primary}
        fillOpacity={0.7}
      />
      {/* Area 2 (if stacked) */}
      {stacked && (
        <path
          d={`M ${points2[0].x} ${points1[0].y} L ${points2.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${size * 0.9} ${points1[4].y} L ${[
            ...points1,
          ]
            .reverse()
            .map((p) => `${p.x} ${p.y}`)
            .join(' L ')} Z`}
          fill={CHART_COLORS.secondary}
          fillOpacity={0.7}
        />
      )}
    </svg>
  );
}

function PieThumbnail({ size, doughnut = false }: { size: number; doughnut?: boolean }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const innerR = doughnut ? r * 0.5 : 0;

  // Create pie slices (40%, 30%, 30%)
  const slices = [
    { percent: 0.4, color: CHART_COLORS.primary },
    { percent: 0.3, color: CHART_COLORS.secondary },
    { percent: 0.3, color: CHART_COLORS.tertiary },
  ];

  let currentAngle = -90; // Start from top
  const paths = slices.map((slice, i) => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + slice.percent * 360;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const largeArc = slice.percent > 0.5 ? 1 : 0;

    if (doughnut) {
      const ix1 = cx + innerR * Math.cos(startRad);
      const iy1 = cy + innerR * Math.sin(startRad);
      const ix2 = cx + innerR * Math.cos(endRad);
      const iy2 = cy + innerR * Math.sin(endRad);
      return (
        <path
          key={i}
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`}
          fill={slice.color}
        />
      );
    }

    return (
      <path
        key={i}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
        fill={slice.color}
      />
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
    </svg>
  );
}

function ScatterThumbnail({ size, withLines = false }: { size: number; withLines?: boolean }) {
  const points = [
    { x: size * 0.2, y: size * 0.65 },
    { x: size * 0.3, y: size * 0.45 },
    { x: size * 0.45, y: size * 0.55 },
    { x: size * 0.55, y: size * 0.35 },
    { x: size * 0.7, y: size * 0.5 },
    { x: size * 0.8, y: size * 0.3 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Axes */}
      <line
        x1={size * 0.1}
        y1={size * 0.85}
        x2={size * 0.9}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <line
        x1={size * 0.1}
        y1={size * 0.15}
        x2={size * 0.1}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Lines if requested */}
      {withLines && (
        <path
          d={`M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
          fill="none"
          stroke={CHART_COLORS.primary}
          strokeWidth={1.5}
          strokeOpacity={0.5}
        />
      )}
      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={CHART_COLORS.primary} />
      ))}
    </svg>
  );
}

function BubbleThumbnail({ size }: { size: number }) {
  const bubbles = [
    { x: size * 0.25, y: size * 0.6, r: 8 },
    { x: size * 0.4, y: size * 0.4, r: 12 },
    { x: size * 0.6, y: size * 0.55, r: 6 },
    { x: size * 0.75, y: size * 0.35, r: 10 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Axes */}
      <line
        x1={size * 0.1}
        y1={size * 0.85}
        x2={size * 0.9}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <line
        x1={size * 0.1}
        y1={size * 0.15}
        x2={size * 0.1}
        y2={size * 0.85}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Bubbles */}
      {bubbles.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={CHART_COLORS.primary} fillOpacity={0.7} />
      ))}
    </svg>
  );
}

function ComboThumbnail({ size }: { size: number }) {
  const baseY = size * 0.85;
  const barWidth = size * 0.12;
  const linePoints = [
    { x: size * 0.2, y: size * 0.5 },
    { x: size * 0.4, y: size * 0.35 },
    { x: size * 0.6, y: size * 0.45 },
    { x: size * 0.8, y: size * 0.25 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {/* Bars */}
      <rect
        x={size * 0.14}
        y={size * 0.4}
        width={barWidth}
        height={size * 0.45}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.34}
        y={size * 0.5}
        width={barWidth}
        height={size * 0.35}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.54}
        y={size * 0.45}
        width={barWidth}
        height={size * 0.4}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      <rect
        x={size * 0.74}
        y={size * 0.35}
        width={barWidth}
        height={size * 0.5}
        fill={CHART_COLORS.primary}
        rx={1}
      />
      {/* Line */}
      <path
        d={`M ${linePoints.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
        fill="none"
        stroke={CHART_COLORS.secondary}
        strokeWidth={2}
      />
      {linePoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={CHART_COLORS.secondary} />
      ))}
    </svg>
  );
}

function RadarThumbnail({
  size,
  filled = false,
  markers = false,
}: {
  size: number;
  filled?: boolean;
  markers?: boolean;
}) {
  const center = size * 0.5;
  const radius = size * 0.34;
  const points = [0, 1, 2, 3, 4].map((i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  });
  const dataPoints = points.map((point, i) => ({
    x: center + (point.x - center) * [0.75, 0.55, 0.9, 0.6, 0.8][i],
    y: center + (point.y - center) * [0.75, 0.55, 0.9, 0.6, 0.8][i],
  }));
  const dataPolygonPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {points.map((point, i) => (
        <line
          key={i}
          x1={center}
          y1={center}
          x2={point.x}
          y2={point.y}
          stroke={CHART_COLORS.axis}
          strokeWidth={1}
        />
      ))}
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      <polygon
        points={dataPolygonPoints}
        fill={filled ? CHART_COLORS.primary : 'none'}
        fillOpacity={filled ? 0.25 : 0}
        stroke={CHART_COLORS.primary}
        strokeWidth={2}
      />
      {markers &&
        dataPoints.map((point, i) => (
          <circle key={i} cx={point.x} cy={point.y} r={2.5} fill={CHART_COLORS.secondary} />
        ))}
    </svg>
  );
}

function StockThumbnail({ size }: { size: number }) {
  const items = [
    { x: 0.24, high: 0.18, low: 0.72, open: 0.42, close: 0.55 },
    { x: 0.42, high: 0.28, low: 0.8, open: 0.62, close: 0.44 },
    { x: 0.6, high: 0.2, low: 0.68, open: 0.38, close: 0.5 },
    { x: 0.78, high: 0.32, low: 0.76, open: 0.58, close: 0.48 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.12}
        y1={size * 0.84}
        x2={size * 0.9}
        y2={size * 0.84}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {items.map((item, i) => {
        const x = size * item.x;
        return (
          <g key={i}>
            <line
              x1={x}
              y1={size * item.high}
              x2={x}
              y2={size * item.low}
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
            />
            <line
              x1={x - size * 0.055}
              y1={size * item.open}
              x2={x}
              y2={size * item.open}
              stroke={CHART_COLORS.secondary}
              strokeWidth={2}
            />
            <line
              x1={x}
              y1={size * item.close}
              x2={x + size * 0.055}
              y2={size * item.close}
              stroke={CHART_COLORS.secondary}
              strokeWidth={2}
            />
          </g>
        );
      })}
    </svg>
  );
}

function FunnelThumbnail({ size }: { size: number }) {
  const segments = [
    { y: 0.18, width: 0.7, color: CHART_COLORS.primary },
    { y: 0.38, width: 0.52, color: CHART_COLORS.secondary },
    { y: 0.58, width: 0.34, color: CHART_COLORS.tertiary },
  ];
  const height = size * 0.18;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((segment, i) => {
        const topWidth = size * segment.width;
        const bottomWidth = size * (segment.width - 0.12);
        const y = size * segment.y;
        return (
          <polygon
            key={i}
            points={[
              `${centeredX(size, topWidth)},${y}`,
              `${centeredX(size, topWidth) + topWidth},${y}`,
              `${centeredX(size, bottomWidth) + bottomWidth},${y + height}`,
              `${centeredX(size, bottomWidth)},${y + height}`,
            ].join(' ')}
            fill={segment.color}
            opacity={0.9}
          />
        );
      })}
    </svg>
  );
}

function centeredX(size: number, width: number): number {
  return (size - width) / 2;
}

function WaterfallThumbnail({ size }: { size: number }) {
  const bars = [
    { x: 0.15, y: 0.55, h: 0.25, color: CHART_COLORS.primary },
    { x: 0.34, y: 0.38, h: 0.22, color: CHART_COLORS.primary },
    { x: 0.53, y: 0.48, h: 0.18, color: CHART_COLORS.secondary },
    { x: 0.72, y: 0.3, h: 0.5, color: CHART_COLORS.tertiary },
  ];
  const width = size * 0.12;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={size * 0.82}
        x2={size * 0.9}
        y2={size * 0.82}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={size * bar.x}
          y={size * bar.y}
          width={width}
          height={size * bar.h}
          fill={bar.color}
          rx={1}
        />
      ))}
      {bars.slice(0, -1).map((bar, i) => (
        <line
          key={i}
          x1={size * bar.x + width}
          y1={size * bar.y}
          x2={size * bars[i + 1].x}
          y2={size * bars[i + 1].y}
          stroke={CHART_COLORS.axis}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ))}
    </svg>
  );
}

function TreemapThumbnail({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect
        x={size * 0.12}
        y={size * 0.16}
        width={size * 0.42}
        height={size * 0.66}
        fill={CHART_COLORS.primary}
      />
      <rect
        x={size * 0.56}
        y={size * 0.16}
        width={size * 0.32}
        height={size * 0.32}
        fill={CHART_COLORS.secondary}
      />
      <rect
        x={size * 0.56}
        y={size * 0.5}
        width={size * 0.16}
        height={size * 0.32}
        fill={CHART_COLORS.tertiary}
      />
      <rect
        x={size * 0.74}
        y={size * 0.5}
        width={size * 0.14}
        height={size * 0.32}
        fill={CHART_COLORS.quaternary}
      />
    </svg>
  );
}

function SunburstThumbnail({ size }: { size: number }) {
  const center = size * 0.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={center}
        cy={center}
        r={size * 0.3}
        fill="none"
        stroke={CHART_COLORS.primary}
        strokeWidth={size * 0.16}
        strokeDasharray={`${size * 0.42} ${size * 0.18}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <circle
        cx={center}
        cy={center}
        r={size * 0.18}
        fill="none"
        stroke={CHART_COLORS.secondary}
        strokeWidth={size * 0.12}
        strokeDasharray={`${size * 0.22} ${size * 0.12}`}
        transform={`rotate(30 ${center} ${center})`}
      />
      <circle cx={center} cy={center} r={size * 0.08} fill={CHART_COLORS.tertiary} />
    </svg>
  );
}

function RegionMapThumbnail({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path
        d={`M ${size * 0.18} ${size * 0.55}
 C ${size * 0.24} ${size * 0.32}, ${size * 0.43} ${size * 0.22}, ${size * 0.58} ${size * 0.3}
 C ${size * 0.74} ${size * 0.38}, ${size * 0.82} ${size * 0.56}, ${size * 0.72} ${size * 0.72}
 C ${size * 0.55} ${size * 0.78}, ${size * 0.34} ${size * 0.76}, ${size * 0.18} ${size * 0.55}`}
        fill={CHART_COLORS.primary}
        fillOpacity={0.25}
        stroke={CHART_COLORS.primary}
        strokeWidth={2}
      />
      <circle cx={size * 0.42} cy={size * 0.45} r={size * 0.055} fill={CHART_COLORS.secondary} />
      <circle cx={size * 0.6} cy={size * 0.58} r={size * 0.07} fill={CHART_COLORS.quaternary} />
    </svg>
  );
}

function HistogramThumbnail({ size }: { size: number }) {
  const bars = [0.34, 0.54, 0.72, 0.5, 0.28];
  const baseY = size * 0.82;
  const width = size * 0.1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line
        x1={size * 0.1}
        y1={baseY}
        x2={size * 0.9}
        y2={baseY}
        stroke={CHART_COLORS.axis}
        strokeWidth={1}
      />
      {bars.map((height, i) => (
        <rect
          key={i}
          x={size * (0.2 + i * 0.12)}
          y={baseY - size * height}
          width={width}
          height={size * height}
          fill={CHART_COLORS.primary}
          rx={1}
        />
      ))}
    </svg>
  );
}

function SurfaceThumbnail({ size }: { size: number }) {
  const cells = [
    [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.quaternary],
    [CHART_COLORS.secondary, CHART_COLORS.quaternary, CHART_COLORS.tertiary],
    [CHART_COLORS.tertiary, CHART_COLORS.primary, CHART_COLORS.secondary],
  ];
  const cell = size * 0.18;
  const startX = size * 0.24;
  const startY = size * 0.28;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {cells.flatMap((row, rowIndex) =>
        row.map((fill, colIndex) => {
          const x = startX + (colIndex - rowIndex) * cell * 0.72;
          const y = startY + (colIndex + rowIndex) * cell * 0.42;
          return (
            <polygon
              key={`${rowIndex}-${colIndex}`}
              points={`${x},${y + cell * 0.35} ${x + cell * 0.72},${y} ${x + cell * 1.44},${y + cell * 0.35} ${x + cell * 0.72},${y + cell * 0.7}`}
              fill={fill}
              stroke="white"
              strokeWidth={0.5}
            />
          );
        }),
      )}
    </svg>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Map variant IDs to their thumbnail components
 */
const THUMBNAIL_MAP: Record<string, React.FC<{ size: number }>> = {
  // Column
  'column-clustered': ClusteredColumnThumbnail,
  'column-stacked': StackedColumnThumbnail,
  'column-100-stacked': PercentStackedColumnThumbnail,
  // Bar
  'bar-clustered': ClusteredBarThumbnail,
  'bar-stacked': StackedBarThumbnail,
  'bar-100-stacked': PercentStackedBarThumbnail,
  // Line
  'line-straight': ({ size }) => <LineThumbnail size={size} />,
  'line-smooth': ({ size }) => <LineThumbnail size={size} smooth />,
  'line-markers': LineWithMarkersThumbnail,
  'line-stepped': SteppedLineThumbnail,
  'line-stacked': ({ size }) => <LineThumbnail size={size} />,
  'line-100-stacked': ({ size }) => <LineThumbnail size={size} />,
  // Area
  'area-standard': ({ size }) => <AreaThumbnail size={size} />,
  'area-stacked': ({ size }) => <AreaThumbnail size={size} stacked />,
  'area-100-stacked': ({ size }) => <AreaThumbnail size={size} stacked />,
  // Pie
  'pie-standard': ({ size }) => <PieThumbnail size={size} />,
  doughnut: ({ size }) => <PieThumbnail size={size} doughnut />,
  // Scatter
  'scatter-points': ({ size }) => <ScatterThumbnail size={size} />,
  'scatter-lines': ({ size }) => <ScatterThumbnail size={size} withLines />,
  'scatter-smooth-lines': ({ size }) => <ScatterThumbnail size={size} withLines />,
  bubble: BubbleThumbnail,
  // Combo
  'combo-column-line': ComboThumbnail,
  // Specialized and statistical
  'radar-basic': ({ size }) => <RadarThumbnail size={size} />,
  'radar-filled': ({ size }) => <RadarThumbnail size={size} filled />,
  'radar-markers': ({ size }) => <RadarThumbnail size={size} markers />,
  'stock-ohlc': StockThumbnail,
  'stock-hlc': StockThumbnail,
  'stock-volume-ohlc': StockThumbnail,
  'stock-volume-hlc': StockThumbnail,
  'funnel-standard': FunnelThumbnail,
  'waterfall-standard': WaterfallThumbnail,
  'treemap-standard': TreemapThumbnail,
  'sunburst-standard': SunburstThumbnail,
  'regionmap-standard': RegionMapThumbnail,
  'histogram-standard': HistogramThumbnail,
  'surface-standard': SurfaceThumbnail,
  'surface-wireframe': SurfaceThumbnail,
  'surface-top-view': SurfaceThumbnail,
  'surface-top-view-wireframe': SurfaceThumbnail,
};

/**
 * ChartVariantThumbnail - Renders a preview thumbnail for a chart variant
 */
export function ChartVariantThumbnail({
  variantId,
  size = 48,
  className = '',
}: ChartVariantThumbnailProps) {
  const ThumbnailComponent = THUMBNAIL_MAP[variantId];

  if (!ThumbnailComponent) {
    // Fallback for unknown variants
    return (
      <div
        className={`flex items-center justify-center bg-ss-surface-secondary rounded ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-ss-text-tertiary text-caption">?</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <ThumbnailComponent size={size} />
    </div>
  );
}
