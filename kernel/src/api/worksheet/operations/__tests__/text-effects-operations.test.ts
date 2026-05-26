import { jest } from '@jest/globals';

import { sheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import type { TextEffectConfig } from '@mog-sdk/contracts/text-effects';

import type { DocumentContext } from '../../../../context';
import type { SpreadsheetObjectManager } from '../../../../floating-objects';
import {
  convertToTextEffect,
  createTextEffect,
  updateTextEffect,
} from '../text-effects-operations';

const SHEET_ID = sheetId('sheet-1');

function createCtx() {
  return {
    eventBus: {
      emit: jest.fn(),
    },
  } as unknown as DocumentContext;
}

function createTextEffectConfig(overrides: Partial<TextEffectConfig> = {}): TextEffectConfig {
  return {
    warpPreset: 'textPlain',
    fill: {
      type: 'gradient',
      gradientType: 'linear',
      angle: 90,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 100, color: '#2F5496' },
      ],
    },
    effects: {
      outerShadow: {
        blurRadius: 40000,
        distance: 25000,
        direction: 45,
        color: '#000000',
        opacity: 0.35,
      },
    },
    followPath: true,
    ...overrides,
  };
}

function createTextBox(id: string, textEffects?: TextEffectConfig): TextBoxObject {
  return {
    id,
    type: 'textbox',
    sheetId: SHEET_ID,
    text: { content: 'Hello' },
    position: { width: 300, height: 100 },
    ...(textEffects ? { textEffects } : {}),
  } as TextBoxObject;
}

describe('TextEffect operations', () => {
  it('creates TextEffect with a persisted visual config and emits the stored config', async () => {
    const ctx = createCtx();
    const manager = {
      createTextEffect: jest.fn(
        async (
          _sheetId: SheetId,
          _text: string,
          _position: unknown,
          options: { textEffects: TextEffectConfig },
        ) => createTextBox('wa-1', options.textEffects),
      ),
    } as unknown as SpreadsheetObjectManager;

    const objectId = await createTextEffect(manager, ctx, SHEET_ID, {
      text: 'Hello',
      warpPreset: 'textArchUp',
      x: 10,
      y: 20,
    });

    expect(objectId).toBe('wa-1');
    expect(manager.createTextEffect).toHaveBeenCalledWith(
      SHEET_ID,
      'Hello',
      expect.objectContaining({ width: 300, height: 100 }),
      expect.objectContaining({
        textEffects: expect.objectContaining({
          warpPreset: 'textArchUp',
          fill: expect.objectContaining({ type: 'gradient' }),
        }),
      }),
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'textEffectsCreated',
        payload: expect.objectContaining({
          objectId: 'wa-1',
          config: expect.objectContaining({ warpPreset: 'textArchUp' }),
        }),
      }),
    );
  });

  it('preserves explicit outline removal in typed update payloads', async () => {
    const ctx = createCtx();
    const manager = {
      getObject: jest.fn(async () => createTextBox('wa-1', createTextEffectConfig())),
      updateTextEffect: jest.fn(async () => undefined),
    } as unknown as SpreadsheetObjectManager;

    await updateTextEffect(manager, ctx, SHEET_ID, 'wa-1', { outline: undefined });

    expect(manager.updateTextEffect).toHaveBeenCalledWith('wa-1', { outline: undefined });
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'textEffectsUpdated',
        payload: expect.objectContaining({
          changes: { outline: undefined },
        }),
      }),
    );
  });

  it('converts text boxes using the warp preset as TextEffect config, not as a color', async () => {
    const ctx = createCtx();
    const manager = {
      getObject: jest.fn(async () => createTextBox('tb-1')),
      convertToTextEffect: jest.fn(async () => undefined),
    } as unknown as SpreadsheetObjectManager;

    await convertToTextEffect(manager, ctx, SHEET_ID, 'tb-1', 'textWave1');

    expect(manager.convertToTextEffect).toHaveBeenCalledWith(
      'tb-1',
      expect.objectContaining({
        warpPreset: 'textWave1',
        fill: expect.objectContaining({ type: 'gradient' }),
      }),
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'textEffectsConverted',
        payload: expect.objectContaining({
          objectId: 'tb-1',
          config: expect.objectContaining({ warpPreset: 'textWave1' }),
        }),
      }),
    );
  });
});
