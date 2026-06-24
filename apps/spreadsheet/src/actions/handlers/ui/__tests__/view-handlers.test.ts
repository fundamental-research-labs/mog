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
  const setZoomLevel = jest.fn();
  const setSheetSetting = jest.fn(() => Promise.resolve());
  return {
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    uiStore: {
      getState: () => ({
        zoomLevels: {},
        setZoomLevel,
      }),
    },
    workbook: {
      mirror: {
        getViewOptions: () => ({}),
      },
      getSheetById: () => ({
        settings: {
          set: setSheetSetting,
        },
      }),
    } as any,
    getActiveSheetId: () => 'sheet1' as any,
    accessors: {} as any,
    commands: {} as any,
    __test: { setZoomLevel, setSheetSetting },
  } as unknown as ActionDependencies & {
    __test: {
      setZoomLevel: jest.Mock;
      setSheetSetting: jest.Mock<Promise<void>, [string, number]>;
    };
  };
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

  describe('SET_ZOOM', () => {
    it('persists zoomScale through worksheet settings', async () => {
      const deps = createMockDeps() as ActionDependencies & {
        __test: {
          setZoomLevel: jest.Mock;
          setSheetSetting: jest.Mock<Promise<void>, [string, number]>;
        };
      };

      const result = await ViewHandlers.SET_ZOOM(deps, {
        sheetId: 'sheet1' as any,
        level: 1.25,
      });

      expect(result.handled).toBe(true);
      expect(deps.__test.setZoomLevel).toHaveBeenCalledWith('sheet1', 1.25);
      expect(deps.__test.setSheetSetting).toHaveBeenCalledWith('zoomScale', 125);
    });
  });
});
