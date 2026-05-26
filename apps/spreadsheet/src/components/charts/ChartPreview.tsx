/**
 * Chart Preview Component
 *
 * A lightweight, read-only chart preview component for use in dialogs
 * and wizards. Shows a live preview of chart configuration without
 * selection, resize, or drag functionality.
 *
 * Live Preview for InsertChartWizardDialog
 */

import { useEffect, useRef } from 'react';

import {
  createChart,
  type ChartData,
  type ChartDataPoint,
  type ChartInstance,
  type StoredChartConfig,
} from '@mog/charts';

// =============================================================================
// Types
// =============================================================================

export interface ChartPreviewProps {
  /** Chart configuration */
  config: StoredChartConfig;
  /** Chart data (categories and series) */
  data: ChartData;
  /** Width of the preview */
  width?: number | string;
  /** Height of the preview */
  height?: number | string;
  /** Optional class name */
  className?: string;
  /** Whether the preview is loading */
  isLoading?: boolean;
  /** Error message if data extraction failed */
  error?: string | null;
}

// =============================================================================
// Sample Data Generator
// =============================================================================

/**
 * Generate sample data for preview when no real data is available.
 * This provides a visual indication of what the chart will look like.
 */
export function generateSampleData(chartType: string): ChartData {
  // Helper to create data points
  const point = (x: string | number, y: number): ChartDataPoint => ({ x, y });

  switch (chartType) {
    case 'pie':
    case 'doughnut':
      return {
        categories: ['A', 'B', 'C', 'D'],
        series: [
          {
            name: 'Sample',
            data: [point('A', 30), point('B', 25), point('C', 20), point('D', 25)],
          },
        ],
      };

    case 'scatter':
      return {
        categories: [],
        series: [
          {
            name: 'Series 1',
            data: [point(10, 20), point(20, 40), point(30, 35), point(40, 50), point(50, 45)],
          },
        ],
      };

    case 'bar':
    case 'column':
    case 'line':
    case 'area':
    default:
      return {
        categories: ['Jan', 'Feb', 'Mar', 'Apr'],
        series: [
          {
            name: 'Series 1',
            data: [point('Jan', 10), point('Feb', 20), point('Mar', 15), point('Apr', 25)],
          },
          {
            name: 'Series 2',
            data: [point('Jan', 15), point('Feb', 18), point('Mar', 22), point('Apr', 20)],
          },
        ],
      };
  }
}

// =============================================================================
// Component
// =============================================================================

export function ChartPreview({
  config,
  data,
  width = '100%',
  height = 300,
  className = '',
  isLoading = false,
  error = null,
}: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  // Initialize and update chart
  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose existing chart
    if (chartRef.current) {
      chartRef.current.dispose();
      chartRef.current = null;
    }

    // Don't render chart if loading or error
    if (isLoading || error) return;

    // Create new chart instance
    try {
      chartRef.current = createChart({
        container: containerRef.current,
        config,
        data,
      });
    } catch (e) {
      // Chart creation failed - likely invalid config
      console.warn('[ChartPreview] Failed to create chart:', e);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [config, data, isLoading, error]);

  // Render loading state
  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-ss-surface-secondary border border-ss-border rounded ${className}`}
        style={{ width, height }}
      >
        <div className="text-ss-text-tertiary text-body-sm">Loading preview...</div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-ss-error-bg border border-ss-error rounded ${className}`}
        style={{ width, height }}
      >
        <div className="text-ss-error text-body-sm text-center p-4">{error}</div>
      </div>
    );
  }

  // Render chart container
  return (
    <div
      ref={containerRef}
      className={`bg-ss-surface border border-ss-border rounded ${className}`}
      style={{ width, height }}
    />
  );
}
