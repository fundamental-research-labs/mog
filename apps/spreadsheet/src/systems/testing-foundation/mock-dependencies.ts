/**
 * Mock Dependency Factories
 *
 * Individual factories for dependencies used by 2+ systems.
 * Each factory is independent — NOT a unified bag.
 *
 * @module systems/testing-foundation
 */

import { jest } from '@jest/globals';

// =============================================================================
// Mock EventBus
// =============================================================================

/**
 * Mock EventBus with emission tracking for test assertions.
 * Simplified version of IEventBus — uses string event names
 * instead of typed SpreadsheetEvent discriminated unions.
 */
export interface MockEventBus {
  emit(event: string, data?: unknown): void;
  on(event: string, fn: (...args: any[]) => void): () => void;
  off(event: string, fn: (...args: any[]) => void): void;
  /** All events emitted since creation (test helper). */
  readonly emitted: Array<{ event: string; data?: unknown }>;
  /** Clear emission log. */
  clearEmitted(): void;
}

export function createMockEventBus(): MockEventBus {
  const emitted: Array<{ event: string; data?: unknown }> = [];
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    emit(event: string, data?: unknown) {
      emitted.push({ event, data });
      const fns = listeners.get(event);
      if (fns) fns.forEach((fn) => fn(data));
    },
    on(event: string, fn: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => {
        listeners.get(event)?.delete(fn);
      };
    },
    off(event: string, fn: (...args: any[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    get emitted() {
      return emitted;
    },
    clearEmitted() {
      emitted.length = 0;
    },
  } as MockEventBus;
}

// =============================================================================
// Mock ComputeBridge
// =============================================================================

/**
 * Mock ComputeBridge with jest.fn() stubs.
 * Used by grid-editing and renderer systems.
 */
export function createMockComputeBridge(): Record<string, jest.Mock> {
  return {
    isRowHidden: jest.fn().mockReturnValue(false),
    isColHidden: jest.fn().mockReturnValue(false),
    setRowHeight: jest.fn().mockResolvedValue(undefined),
    setColWidth: jest.fn().mockResolvedValue(undefined),
    hideRows: jest.fn().mockResolvedValue(undefined),
    unhideRows: jest.fn().mockResolvedValue(undefined),
    hideColumns: jest.fn().mockResolvedValue(undefined),
    unhideColumns: jest.fn().mockResolvedValue(undefined),
    getDataBounds: jest.fn().mockResolvedValue(null),
    getWorkbookSettings: jest.fn().mockResolvedValue({}),
  };
}

// =============================================================================
// Mock HitTestService
// =============================================================================

/**
 * Mock HitTestService (default: all hits return null).
 * Used by objects system.
 */
export function createMockHitTestService() {
  return {
    hitTest: jest.fn().mockReturnValue(null),
    hitTestOutline: jest.fn().mockReturnValue(null),
  };
}

// =============================================================================
// Mock Container Element
// =============================================================================

/**
 * Minimal HTMLElement stub for systems that need mount(container).
 * Used by renderer, objects, and ink systems.
 */
export interface MockContainerElement {
  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  appendChild(child: unknown): unknown;
  removeChild(child: unknown): unknown;
  children: unknown[];
  style: Record<string, string>;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  clientWidth: number;
  clientHeight: number;
}

export function createMockContainerElement(width = 800, height = 600): MockContainerElement {
  const children: unknown[] = [];
  return {
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
    }),
    appendChild: (child: unknown) => {
      children.push(child);
      return child;
    },
    removeChild: (child: unknown) => {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      return child;
    },
    children,
    style: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    clientWidth: width,
    clientHeight: height,
  };
}
