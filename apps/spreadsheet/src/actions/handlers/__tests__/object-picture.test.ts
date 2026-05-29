/**
 * Object Picture Handler Tests — 01 the related wiring.
 *
 * Verifies SAVE_PICTURE_AS_FILE and CHANGE_PICTURE go through
 * `deps.platform.dialogs.*` + `PlatformFileHandle` instead of the old
 * stringly-typed `onUIAction` callback.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import * as ObjectHandlers from '../object';
import { isProtectionRejection } from '../handler-utils';
import { createMockFileHandle, createMockPlatform, createMockShellService } from './test-helpers';

const SHEET_ID = makeSheetId('sheet1');

interface PictureOverrides {
  src?: string;
  fetchBytes?: Uint8Array;
  fetchMime?: string;
  fetchOk?: boolean;
}

function createMockDeps(picture: PictureOverrides = {}): {
  deps: ActionDependencies;
  pictureAdd: jest.Mock;
  textBoxAdd: jest.Mock;
  checkboxAdd: jest.Mock;
  comboBoxAdd: jest.Mock;
  setCell: jest.Mock;
  pictureUpdate: jest.Mock;
  canDoStructureOp: jest.Mock;
  uiState: {
    setSelectionError: jest.Mock;
    showProtectionAlert: jest.Mock;
  };
} {
  const platform = createMockPlatform();
  const shellService = createMockShellService();

  const pictureAdd = jest.fn(async () => ({ id: 'pic-new-1' }));
  const textBoxAdd = jest.fn(async () => ({ id: 'textbox-new-1' }));
  const checkboxAdd = jest.fn(async () => ({ id: 'checkbox-new-1' }));
  const comboBoxAdd = jest.fn(async () => ({ id: 'combobox-new-1' }));
  const setCell = jest.fn(async () => undefined);
  const pictureUpdate = jest.fn(async () => undefined);
  const canDoStructureOp = jest.fn(async () => true);
  const uiState = {
    setSelectionError: jest.fn(),
    showProtectionAlert: jest.fn(),
  };
  const pictureGetData = jest.fn(async () => ({
    src: picture.src ?? 'data:image/png;base64,aGVsbG8=',
    displayName: 'kitten.png',
    originalWidth: 100,
    originalHeight: 100,
  }));

  const pictureHandle = {
    getData: pictureGetData,
    update: pictureUpdate,
  };

  const workbook = {
    getSheetById: jest.fn(() => ({
      pictures: {
        add: pictureAdd,
        get: jest.fn(async () => pictureHandle),
      },
      textBoxes: {
        add: textBoxAdd,
      },
      formControls: {
        addCheckbox: checkboxAdd,
        addComboBox: comboBoxAdd,
      },
      setCell,
      protection: {
        canDoStructureOp,
      },
    })),
    setPendingUndoDescription: jest.fn(),
  };

  // Stub global fetch for SAVE_PICTURE_AS_FILE byte read.
  const fetchBytes = picture.fetchBytes ?? new Uint8Array([0xff, 0xd8, 0xff]);
  const fetchOk = picture.fetchOk ?? true;
  const fetchMime = picture.fetchMime ?? 'image/png';
  (globalThis as any).fetch = jest.fn(async () => ({
    ok: fetchOk,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? fetchMime : null),
    },
    arrayBuffer: async () => fetchBytes.slice().buffer,
  }));

  const deps = {
    platform,
    shellService,
    workbook,
    getActiveSheetId: () => SHEET_ID,
    uiStore: { getState: () => uiState },
    accessors: {
      selection: {
        getActiveCell: () => ({ row: 0, col: 0 }),
        getRanges: () => [{ startRow: 1, startCol: 2, endRow: 1, endCol: 2 }],
        getDataBoundedRanges: () => [{ startRow: 1, startCol: 2, endRow: 1, endCol: 2 }],
      },
      object: {
        getFirstSelectedId: () => null,
        getSelectedIds: () => [],
      },
    },
    commands: {
      object: { keyDelete: jest.fn(), keyEscape: jest.fn(), selectObject: jest.fn() },
      chart: { deselect: jest.fn() },
    },
  } as unknown as ActionDependencies;

  return {
    deps,
    pictureAdd,
    textBoxAdd,
    checkboxAdd,
    comboBoxAdd,
    setCell,
    pictureUpdate,
    canDoStructureOp,
    uiState,
  };
}

describe('object picture handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('INSERT_PICTURE', () => {
    it('reads selected image bytes, inserts via worksheet pictures API, and selects the object', async () => {
      const { deps, pictureAdd } = createMockDeps();
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const handle = createMockFileHandle({ name: 'inserted.png', bytes });
      (deps.platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(handle);

      const result = await ObjectHandlers.INSERT_PICTURE(deps);

      expect(result.handled).toBe(true);
      expect(deps.platform.dialogs.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Insert Picture' }),
      );
      expect(handle.read).toHaveBeenCalled();
      expect(pictureAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          src: expect.stringMatching(/^data:image\/png;base64,/),
          anchorCell: { row: 2, col: 2 },
          width: 200,
          height: 150,
          name: 'inserted.png',
        }),
      );
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('pic-new-1', false, false);
    });

    it('returns notHandled when the insert dialog is cancelled', async () => {
      const { deps, pictureAdd } = createMockDeps();
      (deps.platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(null);

      const result = await ObjectHandlers.INSERT_PICTURE(deps);

      expect(result).toEqual({ handled: false, reason: 'disabled' });
      expect(pictureAdd).not.toHaveBeenCalled();
    });
  });

  describe('INSERT_TEXTBOX', () => {
    it('inserts a visible anchored text box and selects it', async () => {
      const { deps, textBoxAdd } = createMockDeps();

      const result = await ObjectHandlers.INSERT_TEXTBOX(deps, { content: 'Hello' });

      expect(result.handled).toBe(true);
      expect(textBoxAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.objectContaining({ content: 'Hello' }),
          anchorCell: { row: 2, col: 2 },
          width: 150,
          height: 75,
          name: 'Text Box',
        }),
      );
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('textbox-new-1', false, false);
    });
  });

  describe('UPDATE_PICTURE', () => {
    it('delegates the complete Format Picture payload to the picture handle', async () => {
      const { deps, pictureUpdate } = createMockDeps();
      const updates = {
        position: { width: 320, height: 180 },
        locked: true,
        printable: false,
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
        adjustments: { brightness: 10, contrast: -5, transparency: 20 },
        border: { style: 'solid', color: '#336699', width: 2 },
      };

      const result = await ObjectHandlers.UPDATE_PICTURE(deps, {
        objectId: 'pic-1',
        updates,
      });

      expect(result.handled).toBe(true);
      expect(deps.workbook.setPendingUndoDescription).toHaveBeenCalledWith('Update picture');
      expect(pictureUpdate).toHaveBeenCalledWith(updates);
    });
  });

  describe('form control insertion', () => {
    it('inserts a checkbox form control through the worksheet API', async () => {
      const { deps, checkboxAdd, setCell, canDoStructureOp } = createMockDeps();

      const result = await ObjectHandlers.INSERT_FORM_CONTROL_CHECKBOX(deps);

      expect(result.handled).toBe(true);
      expect(deps.workbook.setPendingUndoDescription).toHaveBeenCalledWith('Insert checkbox');
      expect(checkboxAdd).toHaveBeenCalledWith({
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 0 },
      });
      expect(setCell).not.toHaveBeenCalled();
      expect(canDoStructureOp).toHaveBeenCalledWith('editObject');
    });

    it('inserts a combo box form control through the worksheet API', async () => {
      const { deps, comboBoxAdd, canDoStructureOp } = createMockDeps();

      const result = await ObjectHandlers.INSERT_FORM_CONTROL_COMBOBOX(deps);

      expect(result.handled).toBe(true);
      expect(deps.workbook.setPendingUndoDescription).toHaveBeenCalledWith('Insert combo box');
      expect(comboBoxAdd).toHaveBeenCalledWith({
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 0 },
        items: ['Option 1', 'Option 2', 'Option 3'],
        placeholder: 'Select',
      });
      expect(canDoStructureOp).toHaveBeenCalledWith('editObject');
    });

    it('shows protection feedback when checkbox and combo-box insertion is preflight denied', async () => {
      const { deps, checkboxAdd, comboBoxAdd, canDoStructureOp, uiState } = createMockDeps();
      canDoStructureOp.mockResolvedValue(false);

      await expect(ObjectHandlers.INSERT_FORM_CONTROL_CHECKBOX(deps)).resolves.toEqual({
        handled: false,
        reason: 'disabled',
      });
      await expect(ObjectHandlers.INSERT_FORM_CONTROL_COMBOBOX(deps)).resolves.toEqual({
        handled: false,
        reason: 'disabled',
      });

      expect(checkboxAdd).not.toHaveBeenCalled();
      expect(comboBoxAdd).not.toHaveBeenCalled();
      expect(uiState.setSelectionError).toHaveBeenCalledWith('protection', expect.any(String));
      expect(uiState.showProtectionAlert).toHaveBeenCalledWith(expect.any(String));
    });

    it('classifies protected-sheet API errors from form-control insertion', async () => {
      expect(isProtectionRejection({ code: 'API_PROTECTED_SHEET', message: 'blocked' })).toBe(true);
      expect(
        isProtectionRejection({
          code: 'OPERATION_FAILED',
          message: 'Cannot perform editObject: sheet is protected',
        }),
      ).toBe(true);

      const { deps, checkboxAdd, comboBoxAdd, uiState } = createMockDeps();
      const error = Object.assign(new Error('Cannot perform editObject'), {
        code: 'API_PROTECTED_SHEET',
      });
      checkboxAdd.mockRejectedValueOnce(error);
      comboBoxAdd.mockRejectedValueOnce(error);

      await expect(ObjectHandlers.INSERT_FORM_CONTROL_CHECKBOX(deps)).resolves.toEqual({
        handled: false,
        reason: 'disabled',
      });
      await expect(ObjectHandlers.INSERT_FORM_CONTROL_COMBOBOX(deps)).resolves.toEqual({
        handled: false,
        reason: 'disabled',
      });

      expect(uiState.setSelectionError).toHaveBeenCalledWith('protection', error.message);
      expect(uiState.showProtectionAlert).toHaveBeenCalledWith(error.message);
    });
  });

  describe('SAVE_PICTURE_AS_FILE', () => {
    it('reads picture bytes via fetch and writes via platform handle', async () => {
      const { deps } = createMockDeps();
      const handle = createMockFileHandle({ name: 'kitten.png' });
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle);

      const result = await ObjectHandlers.SAVE_PICTURE_AS_FILE(deps, { objectId: 'pic-1' });
      expect(result.handled).toBe(true);
      expect(deps.platform.dialogs.showSaveDialog).toHaveBeenCalled();
      expect(handle.write).toHaveBeenCalled();
      const wroteBytes = (handle.write as jest.Mock).mock.calls[0]![0] as Uint8Array;
      expect(Array.from(wroteBytes)).toEqual([0xff, 0xd8, 0xff]);
    });

    it('returns notHandled when the dialog is cancelled', async () => {
      const { deps } = createMockDeps();
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(null);
      const result = await ObjectHandlers.SAVE_PICTURE_AS_FILE(deps, { objectId: 'pic-1' });
      expect(result).toEqual({ handled: false, reason: 'disabled' });
    });

    it('errors with missing objectId', async () => {
      const { deps } = createMockDeps();
      const result = await ObjectHandlers.SAVE_PICTURE_AS_FILE(deps, {});
      expect(result.handled).toBe(false);
    });
  });

  describe('CHANGE_PICTURE', () => {
    it('reads new bytes via platform handle and pushes data URL into picture', async () => {
      const { deps, pictureUpdate } = createMockDeps();
      const newBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
      const handle = createMockFileHandle({ name: 'replacement.png', bytes: newBytes });
      (deps.platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(handle);

      const result = await ObjectHandlers.CHANGE_PICTURE(deps, { objectId: 'pic-1' });
      expect(result.handled).toBe(true);
      expect(deps.platform.dialogs.showOpenDialog).toHaveBeenCalled();
      expect(handle.read).toHaveBeenCalled();
      expect(pictureUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ src: expect.stringMatching(/^data:image\/png;base64,/) }),
      );
    });

    it('returns notHandled when the dialog is cancelled', async () => {
      const { deps, pictureUpdate } = createMockDeps();
      (deps.platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(null);
      const result = await ObjectHandlers.CHANGE_PICTURE(deps, { objectId: 'pic-1' });
      expect(result).toEqual({ handled: false, reason: 'disabled' });
      expect(pictureUpdate).not.toHaveBeenCalled();
    });
  });
});
