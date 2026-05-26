/**
 * CF Preset Thumbnail Component
 *
 * Canvas-based preview thumbnails for conditional formatting presets.
 * Renders data bars, color scales, and icon sets at small sizes.
 */

import { useEffect, useRef } from 'react';

import { renderIcon } from '@mog/grid-renderer';
import type {
  CFColorScalePreset,
  CFDataBarPreset,
  CFIconSetPreset,
  CFPreset,
} from '@mog-sdk/contracts/conditional-format';
import { ICON_SET_REGISTRY } from '@mog-sdk/contracts/conditional-format';

// =============================================================================
// Types
// =============================================================================

interface CFPresetThumbnailProps {
  preset: CFPreset;
  width?: number;
  height?: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_WIDTH = 48;
const DEFAULT_HEIGHT = 20;

// =============================================================================
// Color Utilities
// =============================================================================

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function adjustAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// =============================================================================
// Render Functions
// =============================================================================

function renderDataBarPreview(
  ctx: CanvasRenderingContext2D,
  preset: CFDataBarPreset,
  width: number,
  height: number,
): void {
  const { dataBar } = preset;
  const padding = 2;
  const barHeight = height * 0.6;
  const barY = (height - barHeight) / 2;
  const barWidth = (width - padding * 2) * 0.75; // 75% filled preview
  const barX = padding;

  // Draw bar with gradient or solid
  if (dataBar.gradient) {
    const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    gradient.addColorStop(0, adjustAlpha(dataBar.positiveColor, 0.3));
    gradient.addColorStop(1, dataBar.positiveColor);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = adjustAlpha(dataBar.positiveColor, 0.7);
  }

  // Rounded rectangle
  const radius = Math.min(2, barHeight / 4);
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, radius);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = adjustAlpha(dataBar.positiveColor, 0.9);
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function renderColorScalePreview(
  ctx: CanvasRenderingContext2D,
  preset: CFColorScalePreset,
  width: number,
  height: number,
): void {
  const { colorScale } = preset;
  const padding = 2;
  const barHeight = height * 0.6;
  const barY = (height - barHeight) / 2;
  const barWidth = width - padding * 2;
  const barX = padding;

  // Create gradient based on color scale points
  const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);

  const minColor = colorScale.minPoint.color;
  const maxColor = colorScale.maxPoint.color;
  const midColor = colorScale.midPoint?.color;

  gradient.addColorStop(0, minColor);
  if (midColor) {
    gradient.addColorStop(0.5, midColor);
  }
  gradient.addColorStop(1, maxColor);

  ctx.fillStyle = gradient;

  // Rounded rectangle
  const radius = Math.min(2, barHeight / 4);
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, radius);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function renderIconSetPreview(
  ctx: CanvasRenderingContext2D,
  preset: CFIconSetPreset,
  width: number,
  height: number,
): void {
  const { iconSet } = preset;
  const meta = ICON_SET_REGISTRY[iconSet.iconSetName];

  const iconCount = meta.iconCount;
  const iconSize = Math.min(14, height * 0.7);
  const gap = 2;
  const totalIconsWidth = iconCount * iconSize + (iconCount - 1) * gap;
  const startX = (width - totalIconsWidth) / 2;

  // Render all icons in the set
  for (let i = 0; i < iconCount; i++) {
    const iconIndex = iconSet.reverseOrder ? iconCount - 1 - i : i;
    const x = startX + i * (iconSize + gap);

    renderIcon(
      ctx,
      { setName: iconSet.iconSetName, iconIndex, iconOnly: true },
      {
        x,
        y: 0,
        width: iconSize,
        height,
        padding: 0,
        size: iconSize,
      },
    );
  }
}

// =============================================================================
// Component
// =============================================================================

export function CFPresetThumbnail({
  preset,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: CFPresetThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle DPR
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Render based on preset type
    switch (preset.category) {
      case 'dataBar':
        renderDataBarPreview(ctx, preset as CFDataBarPreset, width, height);
        break;
      case 'colorScale':
        renderColorScalePreview(ctx, preset as CFColorScalePreset, width, height);
        break;
      case 'iconSet':
        renderIconSetPreview(ctx, preset as CFIconSetPreset, width, height);
        break;
    }
  }, [preset, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
    />
  );
}
