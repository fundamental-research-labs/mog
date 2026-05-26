/**
 * Tests for ChartEngine - chart instance lifecycle management
 *
 * @jest-environment jsdom
 */

import { ChartEngine, createChart } from '../src/dom/chart-engine';
import type { ChartCreateOptions, ChartData, StoredChartConfig } from '../src/types';

// Mock ResizeObserver
const mockResizeObserverDisconnect = jest.fn();
const mockResizeObserverObserve = jest.fn();
class MockResizeObserver {
  observe = mockResizeObserverObserve;
  unobserve = jest.fn();
  disconnect = mockResizeObserverDisconnect;
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock canvas getContext
const mockCanvasContext = {
  clearRect: jest.fn(),
  setTransform: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
  fillRect: jest.fn(),
  strokeRect: jest.fn(),
  fillText: jest.fn(),
  measureText: jest.fn(() => ({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 2,
  })),
  getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: jest.fn(),
  translate: jest.fn(),
  rotate: jest.fn(),
  scale: jest.fn(),
  closePath: jest.fn(),
  quadraticCurveTo: jest.fn(),
  bezierCurveTo: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
  createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  drawImage: jest.fn(),
  ellipse: jest.fn(),
};

HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCanvasContext) as any;
HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,test');

describe('ChartEngine', () => {
  let engine: ChartEngine;
  let mockContainer: HTMLElement;

  const createMockConfig = (id: string): StoredChartConfig => ({
    id,
    type: 'column',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 12,
    dataRange: 'A1:D10',
  });

  const createMockData = (): ChartData => ({
    categories: ['Jan', 'Feb', 'Mar'],
    series: [
      {
        name: 'Sales',
        data: [
          { x: 'Jan', y: 100, name: 'Jan' },
          { x: 'Feb', y: 150, name: 'Feb' },
          { x: 'Mar', y: 200, name: 'Mar' },
        ],
      },
    ],
  });

  beforeEach(() => {
    // Reset singleton state
    engine = ChartEngine.getInstance();
    engine.disposeAll();

    // Reset mocks
    jest.clearAllMocks();

    // Create mock container
    mockContainer = document.createElement('div');
    Object.defineProperty(mockContainer, 'clientWidth', { value: 400 });
    Object.defineProperty(mockContainer, 'clientHeight', { value: 300 });
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    engine.disposeAll();
    mockContainer.remove();
  });

  describe('getInstance', () => {
    it('should return the same instance (singleton)', () => {
      const instance1 = ChartEngine.getInstance();
      const instance2 = ChartEngine.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('create', () => {
    it('should create a new chart instance', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      const chart = engine.create(options);

      expect(chart).toBeDefined();
      expect(chart.id).toBe('chart-1');
    });

    it('should dispose existing chart with same ID before creating new one', () => {
      const options1: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      engine.create(options1);

      // Create new container for second chart
      const mockContainer2 = document.createElement('div');
      Object.defineProperty(mockContainer2, 'clientWidth', { value: 400 });
      Object.defineProperty(mockContainer2, 'clientHeight', { value: 300 });
      document.body.appendChild(mockContainer2);

      const options2: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer2,
      };

      const chart2 = engine.create(options2);

      expect(engine.count).toBe(1);
      expect(engine.get('chart-1')).toBe(chart2);

      mockContainer2.remove();
    });

    it('should initialize with empty data if not provided', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        container: mockContainer,
      };

      const chart = engine.create(options);

      expect(chart.data).toEqual({ categories: [], series: [] });
    });

    it('should throw error if container is not provided', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        container: undefined as unknown as HTMLElement,
      };

      expect(() => engine.create(options)).toThrow('Chart container element is required');
    });

    it('should setup resize observer', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      engine.create(options);

      expect(mockResizeObserverObserve).toHaveBeenCalledWith(mockContainer);
    });
  });

  describe('get', () => {
    it('should return chart instance by ID', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      const created = engine.create(options);
      const retrieved = engine.get('chart-1');

      expect(retrieved).toBe(created);
    });

    it('should return undefined for non-existent chart', () => {
      const chart = engine.get('non-existent');
      expect(chart).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update chart configuration', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      const chart = engine.create(options);
      engine.update('chart-1', { title: 'Updated Title' });

      expect(chart.config.title).toBe('Updated Title');
    });

    it('should do nothing for non-existent chart', () => {
      // Should not throw
      engine.update('non-existent', { title: 'Test' });
    });
  });

  describe('setData', () => {
    it('should update chart data', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      const chart = engine.create(options);

      const newData: ChartData = {
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [
          {
            name: 'Revenue',
            data: [
              { x: 'Q1', y: 1000, name: 'Q1' },
              { x: 'Q2', y: 1200, name: 'Q2' },
              { x: 'Q3', y: 1400, name: 'Q3' },
              { x: 'Q4', y: 1600, name: 'Q4' },
            ],
          },
        ],
      };

      engine.setData('chart-1', newData);

      expect(chart.data).toEqual(newData);
    });

    it('should do nothing for non-existent chart', () => {
      // Should not throw
      engine.setData('non-existent', createMockData());
    });
  });

  describe('dispose', () => {
    it('should dispose chart and remove from registry', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      engine.create(options);
      expect(engine.count).toBe(1);

      engine.dispose('chart-1');

      expect(engine.count).toBe(0);
      expect(engine.get('chart-1')).toBeUndefined();
    });

    it('should disconnect resize observer on dispose', () => {
      const options: ChartCreateOptions = {
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      };

      engine.create(options);
      engine.dispose('chart-1');

      expect(mockResizeObserverDisconnect).toHaveBeenCalled();
    });

    it('should do nothing for non-existent chart', () => {
      // Should not throw
      engine.dispose('non-existent');
    });
  });

  describe('disposeAll', () => {
    it('should dispose all charts', () => {
      const container2 = document.createElement('div');
      Object.defineProperty(container2, 'clientWidth', { value: 400 });
      Object.defineProperty(container2, 'clientHeight', { value: 300 });
      document.body.appendChild(container2);

      engine.create({
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      });
      engine.create({
        config: createMockConfig('chart-2'),
        data: createMockData(),
        container: container2,
      });

      expect(engine.count).toBe(2);

      engine.disposeAll();

      expect(engine.count).toBe(0);

      container2.remove();
    });
  });

  describe('getChartIds', () => {
    it('should return all chart IDs', () => {
      const container2 = document.createElement('div');
      Object.defineProperty(container2, 'clientWidth', { value: 400 });
      Object.defineProperty(container2, 'clientHeight', { value: 300 });
      document.body.appendChild(container2);

      engine.create({
        config: createMockConfig('chart-1'),
        container: mockContainer,
      });
      engine.create({
        config: createMockConfig('chart-2'),
        container: container2,
      });

      const ids = engine.getChartIds();

      expect(ids).toHaveLength(2);
      expect(ids).toContain('chart-1');
      expect(ids).toContain('chart-2');

      container2.remove();
    });
  });

  describe('count', () => {
    it('should return the number of charts', () => {
      expect(engine.count).toBe(0);

      engine.create({
        config: createMockConfig('chart-1'),
        container: mockContainer,
      });

      expect(engine.count).toBe(1);
    });
  });

  describe('exportImage', () => {
    it('should export chart as data URL', () => {
      engine.create({
        config: createMockConfig('chart-1'),
        data: createMockData(),
        container: mockContainer,
      });

      const dataUrl = engine.exportImage('chart-1');

      expect(dataUrl).toBe('data:image/png;base64,test');
    });

    it('should return null for non-existent chart', () => {
      const dataUrl = engine.exportImage('non-existent');
      expect(dataUrl).toBeNull();
    });
  });
});

describe('ChartInstance', () => {
  let mockContainer: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContainer = document.createElement('div');
    Object.defineProperty(mockContainer, 'clientWidth', { value: 400 });
    Object.defineProperty(mockContainer, 'clientHeight', { value: 300 });
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    mockContainer.remove();
  });

  describe('update', () => {
    it('should not update after dispose', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        container: mockContainer,
      });

      chart.dispose();
      const originalTitle = chart.config.title;

      chart.update({ title: 'New Title' });

      // After dispose, updates should be ignored
      expect(chart.config.title).toBe(originalTitle);
    });
  });

  describe('setData', () => {
    it('should not setData after dispose', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        data: {
          categories: ['A', 'B'],
          series: [{ name: 'S1', data: [{ x: 'A', y: 1, name: 'A' }] }],
        },
        container: mockContainer,
      });

      const originalData = chart.data;
      chart.dispose();

      chart.setData({ categories: [], series: [] });

      // After dispose, setData should be ignored
      expect(chart.data).toEqual(originalData);
    });
  });

  describe('resize', () => {
    it('should not resize after dispose', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        container: mockContainer,
      });

      chart.dispose();

      // Should not throw
      chart.resize();
    });
  });

  describe('dispose', () => {
    it('should be idempotent (safe to call multiple times)', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        container: mockContainer,
      });

      chart.dispose();
      chart.dispose(); // Should not throw
      chart.dispose(); // Should not throw
    });
  });

  describe('exportImage', () => {
    it('should return data URL', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        data: {
          categories: ['A', 'B', 'C'],
          series: [
            {
              name: 'Values',
              data: [
                { x: 'A', y: 30, name: 'A' },
                { x: 'B', y: 50, name: 'B' },
                { x: 'C', y: 20, name: 'C' },
              ],
            },
          ],
        },
        container: mockContainer,
      });

      const dataUrl = chart.exportImage();
      expect(dataUrl).toBe('data:image/png;base64,test');
    });

    it('should return null after dispose', () => {
      const chart = createChart({
        config: {
          id: 'test',
          type: 'column',
          anchorRow: 0,
          anchorCol: 0,
          width: 8,
          height: 12,
          dataRange: 'A1:D10',
        },
        container: mockContainer,
      });

      chart.dispose();
      const dataUrl = chart.exportImage();

      expect(dataUrl).toBeNull();
    });
  });
});

describe('createChart', () => {
  let mockContainer: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContainer = document.createElement('div');
    Object.defineProperty(mockContainer, 'clientWidth', { value: 400 });
    Object.defineProperty(mockContainer, 'clientHeight', { value: 300 });
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    mockContainer.remove();
  });

  it('should create a standalone chart instance', () => {
    const chart = createChart({
      config: {
        id: 'standalone',
        type: 'pie',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 8,
        dataRange: 'A1:B5',
      },
      data: {
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'Values',
            data: [
              { x: 'A', y: 30, name: 'A' },
              { x: 'B', y: 50, name: 'B' },
              { x: 'C', y: 20, name: 'C' },
            ],
          },
        ],
      },
      container: mockContainer,
    });

    expect(chart).toBeDefined();
    expect(chart.id).toBe('standalone');
  });
});
