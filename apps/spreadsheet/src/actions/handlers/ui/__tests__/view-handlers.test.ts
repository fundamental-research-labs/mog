/**
 * View Handler Tests — 01 the related wiring migrations only.
 *
 * Verifies that FULL_SCREEN goes through the browser API directly instead of
 * the old `onUIAction` callback indirection.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import * as ViewHandlers from '../view-handlers';
import { createMockPlatform, createMockShellService } from '../../__tests__/test-helpers';

function createMockDeps(): ActionDependencies {
  return {
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    uiStore: { getState: () => ({}) },
    workbook: {} as any,
    getActiveSheetId: () => 'sheet1' as any,
    accessors: {} as any,
    commands: {} as any,
  } as unknown as ActionDependencies;
}

describe('view handler migrations', () => {
  let originalRequestFullscreen: any;
  let originalExitFullscreen: any;
  let requestSpy: jest.Mock;
  let exitSpy: jest.Mock;

  beforeEach(() => {
    requestSpy = jest.fn(() => Promise.resolve());
    exitSpy = jest.fn(() => Promise.resolve());
    originalRequestFullscreen = (document.documentElement as any).requestFullscreen;
    originalExitFullscreen = (document as any).exitFullscreen;
    (document.documentElement as any).requestFullscreen = requestSpy;
    (document as any).exitFullscreen = exitSpy;
  });

  afterEach(() => {
    (document.documentElement as any).requestFullscreen = originalRequestFullscreen;
    (document as any).exitFullscreen = originalExitFullscreen;
  });

  describe('FULL_SCREEN', () => {
    it('calls document.documentElement.requestFullscreen() when not in fullscreen', () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
      const result = ViewHandlers.FULL_SCREEN(createMockDeps());
      expect(result.handled).toBe(true);
      expect(requestSpy).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('calls document.exitFullscreen() when already in fullscreen', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      const result = ViewHandlers.FULL_SCREEN(createMockDeps());
      expect(result.handled).toBe(true);
      expect(exitSpy).toHaveBeenCalled();
      expect(requestSpy).not.toHaveBeenCalled();
    });
  });
});
