/**
 * File Handler Tests
 *
 * Verifies the migrated file handlers go
 * through `deps.platform.dialogs.*` and `deps.shellService.*` instead of
 * the old `onUIAction` / `window.__SHELL__` reach-arounds.
 *
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import * as FileHandlers from '../file-handlers';
import {
  createMockFileHandle,
  createMockPlatform,
  createMockShellService,
} from '../../__tests__/test-helpers';

const SHEET_ID = makeSheetId('sheet1');
const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf];

interface DepsOverrides {
  platform?: ReturnType<typeof createMockPlatform>;
  shellService?: ReturnType<typeof createMockShellService>;
  workbookXlsxBytes?: Uint8Array;
  worksheetCsv?: string;
  activeCell?: { row: number; col: number } | null;
  selectionRanges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  selectionSnapshot?: {
    activeCell?: { row: number; col: number } | null;
    ranges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  };
  hostCommands?: ActionDependencies['hostCommands'];
}

function createMockDeps(overrides: DepsOverrides = {}): ActionDependencies {
  const platform = overrides.platform ?? createMockPlatform();
  const shellService = overrides.shellService ?? createMockShellService();
  const xlsxBytes = overrides.workbookXlsxBytes ?? new Uint8Array([1, 2, 3, 4]);
  const csv = overrides.worksheetCsv ?? 'a,b\n1,2\n';
  const worksheet = {
    toCSV: jest.fn(async () => csv),
    settings: {
      set: jest.fn(async () => undefined),
    },
  };

  const workbook = {
    toXlsx: jest.fn(async () => xlsxBytes),
    calculate: jest.fn(async () => undefined),
    notifications: {
      info: jest.fn(),
    },
    getSheetById: jest.fn(() => worksheet),
  };

  const uiStore = {
    getState: () => ({
      openBackstage: jest.fn(),
      closeBackstage: jest.fn(),
      setActivePanel: jest.fn(),
      showNotification: jest.fn(),
    }),
  };

  return {
    workbook,
    uiStore,
    getActiveSheetId: () => SHEET_ID,
    getSelection: overrides.selectionSnapshot ? () => overrides.selectionSnapshot : undefined,
    accessors: {
      editor: { isEditing: () => false },
      selection: {
        getActiveCell: () => overrides.activeCell ?? null,
        getRanges: () => overrides.selectionRanges ?? [],
      },
    },
    commands: {
      editor: { cancel: jest.fn() },
      findReplace: {
        findNext: jest.fn(),
        findPrevious: jest.fn(),
      },
    },
    platform,
    shellService,
    hostCommands: overrides.hostCommands,
  } as unknown as ActionDependencies;
}

describe('file handler migrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SAVE', () => {
    it('writes through stored handle without re-prompting', async () => {
      const handle = createMockFileHandle({ name: 'doc.xlsx' });
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'fid-1',
        openFileIds: ['fid-1'],
        files: { 'fid-1': { id: 'fid-1', displayName: 'doc.xlsx', handle } },
      });
      const xlsxBytes = new Uint8Array([7, 7, 7]);
      const deps = createMockDeps({ shellService, workbookXlsxBytes: xlsxBytes });

      const result = await FileHandlers.SAVE(deps);
      expect(result.handled).toBe(true);
      expect(deps.platform.dialogs.showSaveDialog).not.toHaveBeenCalled();
      expect(handle.write).toHaveBeenCalledWith(xlsxBytes);
      expect(shellService.setDocumentHandle).toHaveBeenCalledWith('fid-1', handle);
    });

    it('prompts via showSaveDialog when no handle is stored', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'Untitled.xlsx' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);

      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'fid-2',
        openFileIds: ['fid-2'],
        files: { 'fid-2': { id: 'fid-2', displayName: 'Untitled.xlsx' } },
      });
      const deps = createMockDeps({ platform, shellService });

      const result = await FileHandlers.SAVE(deps);
      expect(result.handled).toBe(true);
      expect(platform.dialogs.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'Untitled.xlsx' }),
      );
      expect(handle.write).toHaveBeenCalled();
      expect(shellService.setDocumentHandle).toHaveBeenCalledWith('fid-2', handle);
    });

    it('returns notHandled when the dialog is cancelled', async () => {
      const platform = createMockPlatform();
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(null);
      const deps = createMockDeps({ platform });

      const result = await FileHandlers.SAVE(deps);
      expect(result).toEqual({ handled: false, reason: 'disabled' });
    });
  });

  describe('EXPORT_FILE (Save As)', () => {
    it('always prompts — never reuses stored handle', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'a.xlsx' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      // Set existing stored handle that EXPORT_FILE must NOT reuse.
      const existingHandle = createMockFileHandle({ name: 'old.xlsx' });
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'fid-3',
        openFileIds: ['fid-3'],
        files: { 'fid-3': { id: 'fid-3', displayName: 'a.xlsx', handle: existingHandle } },
      });
      const deps = createMockDeps({ platform, shellService });

      await FileHandlers.EXPORT_FILE(deps);
      expect(platform.dialogs.showSaveDialog).toHaveBeenCalled();
      expect(handle.write).toHaveBeenCalled();
      expect(existingHandle.write).not.toHaveBeenCalled();
      expect(shellService.setDocumentHandle).toHaveBeenCalledWith('fid-3', handle);
    });
  });

  describe('OPEN', () => {
    it('reads bytes through handle and routes to shellService.loadDocument', async () => {
      const platform = createMockPlatform();
      const bytes = new Uint8Array([10, 20]);
      const handle = createMockFileHandle({ name: 'data.xlsx', bytes });
      (platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.loadDocument as jest.Mock).mockResolvedValue('new-fid');
      const deps = createMockDeps({ platform, shellService });

      const result = await FileHandlers.OPEN(deps);
      expect(result.handled).toBe(true);
      expect(handle.read).toHaveBeenCalled();
      expect(shellService.loadDocument).toHaveBeenCalledWith('data.xlsx', bytes, { kind: 'xlsx' });
      expect(shellService.setDocumentHandle).toHaveBeenCalledWith('new-fid', handle);
    });

    it('infers csv kind from .csv extension', async () => {
      const platform = createMockPlatform();
      const bytes = new Uint8Array([0xff]);
      const handle = createMockFileHandle({ name: 'foo.csv', bytes });
      (platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      const deps = createMockDeps({ platform, shellService });

      await FileHandlers.OPEN(deps);
      expect(shellService.loadDocument).toHaveBeenCalledWith('foo.csv', bytes, { kind: 'csv' });
    });

    it('returns notHandled when the dialog is cancelled', async () => {
      const platform = createMockPlatform();
      (platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(null);
      const deps = createMockDeps({ platform });
      const result = await FileHandlers.OPEN(deps);
      expect(result).toEqual({ handled: false, reason: 'disabled' });
    });
  });

  describe('NEW_WORKBOOK', () => {
    it('delegates to shellService.newDocument', async () => {
      const shellService = createMockShellService();
      const deps = createMockDeps({ shellService });
      await FileHandlers.NEW_WORKBOOK(deps);
      expect(shellService.newDocument).toHaveBeenCalled();
    });
  });

  describe('CLOSE_WORKBOOK', () => {
    it('delegates to shellService.closeActiveDocument', async () => {
      const shellService = createMockShellService();
      const deps = createMockDeps({ shellService });
      await FileHandlers.CLOSE_WORKBOOK(deps);
      expect(shellService.closeActiveDocument).toHaveBeenCalled();
    });
  });

  describe('CLOSE_FILE', () => {
    it('closes backstage and the active document', async () => {
      const shellService = createMockShellService();
      const closeBackstage = jest.fn();
      const deps = createMockDeps({ shellService });
      // Patch closeBackstage on uiStore.getState() used by handler.
      (deps.uiStore as any).getState = () => ({ closeBackstage });
      await FileHandlers.CLOSE_FILE(deps);
      expect(closeBackstage).toHaveBeenCalled();
      expect(shellService.closeActiveDocument).toHaveBeenCalled();
    });
  });

  describe('EXPORT_AS_XLSX', () => {
    it('writes serialised bytes through the platform handle', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'doc.xlsx' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'f',
        openFileIds: ['f'],
        files: { f: { id: 'f', displayName: 'doc.xlsx' } },
      });
      const xlsxBytes = new Uint8Array([1, 2, 3]);
      const deps = createMockDeps({ platform, shellService, workbookXlsxBytes: xlsxBytes });

      await FileHandlers.EXPORT_AS_XLSX(deps);
      expect(platform.dialogs.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'doc.xlsx' }),
      );
      expect(handle.write).toHaveBeenCalledWith(xlsxBytes);
    });

    it('persists current active-sheet selection before serialising XLSX bytes', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'doc.xlsx' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'f',
        openFileIds: ['f'],
        files: { f: { id: 'f', displayName: 'doc.xlsx' } },
      });
      const deps = createMockDeps({
        platform,
        shellService,
        activeCell: { row: 3, col: 2 },
        selectionRanges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
      });

      await FileHandlers.EXPORT_AS_XLSX(deps);

      const worksheet = (deps.workbook.getSheetById as jest.Mock).mock.results[0]!.value as {
        settings: { set: jest.Mock };
      };
      expect(worksheet.settings.set).toHaveBeenCalledWith('activeCell', 'C4');
      expect(worksheet.settings.set).toHaveBeenCalledWith('sqref', 'C4');
      expect(worksheet.settings.set.mock.invocationCallOrder[0]).toBeLessThan(
        (deps.workbook.toXlsx as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('persists current active-sheet selection before delegating XLSX export to host', async () => {
      const hostCommands = {
        getOwner: jest.fn(() => 'host' as const),
        request: jest.fn(async () => ({ status: 'handled' as const })),
      };
      const deps = createMockDeps({
        hostCommands,
        activeCell: { row: 3, col: 2 },
        selectionRanges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
      });

      const result = await FileHandlers.EXPORT_AS_XLSX(deps);

      const worksheet = (deps.workbook.getSheetById as jest.Mock).mock.results[0]!.value as {
        settings: { set: jest.Mock };
      };
      expect(result.handled).toBe(true);
      expect(worksheet.settings.set).toHaveBeenCalledWith('activeCell', 'C4');
      expect(worksheet.settings.set).toHaveBeenCalledWith('sqref', 'C4');
      expect(worksheet.settings.set.mock.invocationCallOrder[0]).toBeLessThan(
        hostCommands.request.mock.invocationCallOrder[0],
      );
      expect(deps.platform.dialogs.showSaveDialog).not.toHaveBeenCalled();
      expect(deps.workbook.toXlsx).not.toHaveBeenCalled();
    });

    it('prefers the live selection snapshot over stale selection accessors', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'doc.xlsx' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'f',
        openFileIds: ['f'],
        files: { f: { id: 'f', displayName: 'doc.xlsx' } },
      });
      const deps = createMockDeps({
        platform,
        shellService,
        activeCell: { row: 0, col: 0 },
        selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        selectionSnapshot: {
          activeCell: { row: 3, col: 2 },
          ranges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
        },
      });

      await FileHandlers.EXPORT_AS_XLSX(deps);

      const worksheet = (deps.workbook.getSheetById as jest.Mock).mock.results[0]!.value as {
        settings: { set: jest.Mock };
      };
      expect(worksheet.settings.set).toHaveBeenCalledWith('activeCell', 'C4');
      expect(worksheet.settings.set).toHaveBeenCalledWith('sqref', 'C4');
    });
  });

  describe('EXPORT_AS_CSV', () => {
    it('writes csv download bytes with one UTF-8 BOM prefix', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'doc.csv' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'f',
        openFileIds: ['f'],
        files: { f: { id: 'f', displayName: 'doc.csv' } },
      });
      const deps = createMockDeps({ platform, shellService, worksheetCsv: 'a,b\n' });

      await FileHandlers.EXPORT_AS_CSV(deps);
      expect(platform.dialogs.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'doc.csv' }),
      );
      const writeArg = (handle.write as jest.Mock).mock.calls[0]![0] as Uint8Array;
      expect(Array.from(writeArg.slice(0, 3))).toEqual(UTF8_BOM_BYTES);
      expect(new TextDecoder().decode(writeArg)).toBe('a,b\n');
    });

    it('does not duplicate a BOM if toCSV already returned one', async () => {
      const platform = createMockPlatform();
      const handle = createMockFileHandle({ name: 'doc.csv' });
      (platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'f',
        openFileIds: ['f'],
        files: { f: { id: 'f', displayName: 'doc.csv' } },
      });
      const deps = createMockDeps({ platform, shellService, worksheetCsv: '\ufeffa,b\n' });

      await FileHandlers.EXPORT_AS_CSV(deps);

      const writeArg = (handle.write as jest.Mock).mock.calls[0]![0] as Uint8Array;
      expect(Array.from(writeArg.slice(0, 3))).toEqual(UTF8_BOM_BYTES);
      expect(Array.from(writeArg.slice(3, 6))).not.toEqual(UTF8_BOM_BYTES);
      expect(new TextDecoder().decode(writeArg)).toBe('a,b\n');
    });
  });

  describe('REFRESH_ALL_DATA', () => {
    it('calls workbook.calculate and never falls back to onUIAction', async () => {
      const deps = createMockDeps();
      // ensure no onUIAction is called
      (deps as any).onUIAction = jest.fn();
      await FileHandlers.REFRESH_ALL_DATA(deps);
      expect(deps.workbook.calculate).toHaveBeenCalled();
      expect((deps as any).onUIAction).not.toHaveBeenCalled();
    });
  });

  describe('REFRESH_CONNECTION', () => {
    it('returns notHandled (disabled) — no callback fallback', () => {
      const deps = createMockDeps();
      (deps as any).onUIAction = jest.fn();
      const result = FileHandlers.REFRESH_CONNECTION(deps);
      expect(result).toEqual({ handled: false, reason: 'disabled' });
      expect((deps as any).onUIAction).not.toHaveBeenCalled();
    });
  });

  describe('OPEN_BACKSTAGE', () => {
    it('opens backstage by default', () => {
      const openBackstage = jest.fn();
      const deps = createMockDeps();
      (deps.uiStore as any).getState = () => ({ openBackstage });

      const result = FileHandlers.OPEN_BACKSTAGE(deps);

      expect(result).toEqual({ handled: true });
      expect(openBackstage).toHaveBeenCalled();
    });

    it('returns disabled when the file menu feature gate is hidden', () => {
      const openBackstage = jest.fn();
      const deps = createMockDeps();
      (deps as any).featureGates = { capabilities: { fileMenu: false } };
      (deps.uiStore as any).getState = () => ({ openBackstage });

      const result = FileHandlers.OPEN_BACKSTAGE(deps);

      expect(result).toEqual({ handled: false, reason: 'disabled' });
      expect(openBackstage).not.toHaveBeenCalled();
    });
  });

  describe('OPEN_RECENT_FILE', () => {
    it('switches active document via shellService', () => {
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'a',
        openFileIds: ['a', 'b'],
        files: {},
      });
      const closeBackstage = jest.fn();
      const deps = createMockDeps({ shellService });
      (deps.uiStore as any).getState = () => ({ closeBackstage });

      const result = FileHandlers.OPEN_RECENT_FILE(deps, { fileId: 'b' });
      expect(result.handled).toBe(true);
      expect(shellService.setActiveDocument).toHaveBeenCalledWith('b');
      expect(closeBackstage).toHaveBeenCalled();
    });

    it('falls back to first non-active id when no payload', () => {
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: 'a',
        openFileIds: ['a', 'b'],
        files: {},
      });
      const closeBackstage = jest.fn();
      const deps = createMockDeps({ shellService });
      (deps.uiStore as any).getState = () => ({ closeBackstage });

      FileHandlers.OPEN_RECENT_FILE(deps);
      expect(shellService.setActiveDocument).toHaveBeenCalledWith('b');
    });

    it('returns notHandled when there are no candidates', () => {
      const shellService = createMockShellService();
      (shellService.getDocumentState as jest.Mock).mockReturnValue({
        activeFileId: null,
        openFileIds: [],
        files: {},
      });
      const deps = createMockDeps({ shellService });
      (deps.uiStore as any).getState = () => ({ closeBackstage: jest.fn() });
      const result = FileHandlers.OPEN_RECENT_FILE(deps);
      expect(result).toEqual({ handled: false, reason: 'disabled' });
    });
  });

  describe('FIND_NEXT / FIND_PREVIOUS', () => {
    it('FIND_NEXT calls commands.findReplace.findNext when available', () => {
      const deps = createMockDeps();
      const result = FileHandlers.FIND_NEXT(deps);
      expect(result.handled).toBe(true);
      expect(deps.commands.findReplace!.findNext).toHaveBeenCalled();
    });

    it('FIND_PREVIOUS calls commands.findReplace.findPrevious when available', () => {
      const deps = createMockDeps();
      const result = FileHandlers.FIND_PREVIOUS(deps);
      expect(result.handled).toBe(true);
      expect(deps.commands.findReplace!.findPrevious).toHaveBeenCalled();
    });

    it('returns notHandled (disabled) when findReplace is absent', () => {
      const deps = createMockDeps();
      (deps as any).commands.findReplace = undefined;
      (deps as any).onUIAction = jest.fn();
      expect(FileHandlers.FIND_NEXT(deps)).toEqual({ handled: false, reason: 'disabled' });
      expect(FileHandlers.FIND_PREVIOUS(deps)).toEqual({ handled: false, reason: 'disabled' });
      expect((deps as any).onUIAction).not.toHaveBeenCalled();
    });
  });

  describe('SHARE_DOCUMENT', () => {
    it('shows a workbook notification (no onUIAction fallback)', async () => {
      const deps = createMockDeps();
      (deps as any).onUIAction = jest.fn();

      const result = await FileHandlers.SHARE_DOCUMENT(deps);
      expect(result.handled).toBe(true);
      expect(deps.workbook.notifications.info).toHaveBeenCalledWith(
        'Sharing requires a connected workspace. Coming soon.',
      );
      expect((deps as any).onUIAction).not.toHaveBeenCalled();
    });
  });
});
