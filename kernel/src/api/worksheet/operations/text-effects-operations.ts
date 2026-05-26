/**
 * TextEffect Operations Module
 *
 * Extracted from coordinator mutations — standalone functions for TextEffect manipulation.
 * All functions take manager: SpreadsheetObjectManager, ctx: DocumentContext, and
 * sheetId: SheetId as the first three params.
 *
 * TextEffect is implemented as a TextBoxObject with a `textEffects` property — NOT a separate
 * floating object type. All operations verify the target object is a textbox with TextEffect
 * config before proceeding.
 *
 * Event emission: Uses ctx.eventBus.emit() with properly typed SpreadsheetEvent instances.
 * DocumentContext inherits eventBus: IEventBus from IKernelContext.
 *
 * Functions throw KernelError on failure instead of returning OperationResult.
 */

import type {
  CreateTextEffectInput,
  TextEffectTextFormatUpdate,
  TextEffectUpdates,
} from '@mog-sdk/contracts/api';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  TextEffectConvertedEvent,
  TextEffectCreatedEvent,
  TextEffectRemovedEvent,
  TextEffectUpdatedEvent,
} from '@mog-sdk/contracts/events';
import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import type {
  TextWarpPreset,
  TextEffectConfig as InternalTextEffectConfig,
  TextEffectConfigUpdate,
} from '@mog-sdk/contracts/text-effects';

import { operationFailed, textEffectNotFound } from '../../../errors/api';
import type { SpreadsheetObjectManager } from '../../../floating-objects';
import { createGradientTextEffectConfig } from '../../../domain/text-effects/text-effects-defaults';

import type { DocumentContext } from './shared';

// =============================================================================
// Private Helpers
// =============================================================================

export const DEFAULT_TEXT_EFFECT_WIDTH = 300;
export const DEFAULT_TEXT_EFFECT_HEIGHT = 100;

type TextEffectTextBoxObject = TextBoxObject & { textEffects: InternalTextEffectConfig };
type TextEffectMutationEvent =
  | TextEffectCreatedEvent
  | TextEffectUpdatedEvent
  | TextEffectRemovedEvent
  | TextEffectConvertedEvent;

function emitEvent(ctx: DocumentContext, event: TextEffectMutationEvent): void {
  ctx.eventBus.emit(event);
}

export function createDefaultApiTextEffectConfig(
  warpPreset?: TextWarpPreset,
): InternalTextEffectConfig {
  return warpPreset === undefined
    ? createTextEffectObjectConfig({})
    : createTextEffectObjectConfig({ warpPreset });
}

function createTextEffectObjectConfig(
  input: Partial<CreateTextEffectInput>,
): InternalTextEffectConfig {
  const defaults = createGradientTextEffectConfig();
  const override = input.textEffects;
  const warpAdjustments =
    override?.warpAdjustments ?? input.warpAdjustments ?? defaults.warpAdjustments;
  const outline = override?.outline ?? input.outline ?? defaults.outline;
  const effects = override?.effects ?? input.effects ?? defaults.effects;

  const config: InternalTextEffectConfig = {
    ...defaults,
    ...override,
    warpPreset: override?.warpPreset ?? input.warpPreset ?? defaults.warpPreset,
    fill: override?.fill ?? input.fill ?? defaults.fill,
  };
  if (warpAdjustments !== undefined) config.warpAdjustments = warpAdjustments;
  if (outline !== undefined) config.outline = outline;
  if (effects !== undefined) config.effects = effects;
  return config;
}

/**
 * Verify an object exists and is a textbox with TextEffect config.
 * Returns the TextBoxObject or throws if checks fail.
 */
async function requireTextEffect(
  manager: SpreadsheetObjectManager,
  objectId: string,
): Promise<TextEffectTextBoxObject> {
  const obj = await manager.getObject(objectId);
  if (!obj || obj.type !== 'textbox') {
    throw textEffectNotFound(objectId);
  }
  if (!obj.textEffects) {
    throw textEffectNotFound(objectId);
  }
  return { ...obj, textEffects: obj.textEffects };
}

// =============================================================================
// TextEffect Operations
// =============================================================================

/**
 * Create a new TextEffect object on a sheet.
 * Throws KernelError if text is missing or creation fails.
 *
 * @returns The created TextEffect object ID
 */
export async function createTextEffect(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  config: CreateTextEffectInput,
): Promise<string> {
  if (!config.text) {
    throw operationFailed('createTextEffect', 'text is required');
  }

  const anchorRow = 0;
  const anchorCol = 0;

  const position = {
    from: {
      cellId: toCellId(`cell-${anchorRow}-${anchorCol}`),
      xOffset: config.x ?? 0,
      yOffset: config.y ?? 0,
    },
    width: config.width ?? DEFAULT_TEXT_EFFECT_WIDTH,
    height: config.height ?? DEFAULT_TEXT_EFFECT_HEIGHT,
  };

  const textEffectsConfig = createTextEffectObjectConfig(config);
  const options =
    config.name === undefined
      ? { textEffects: textEffectsConfig }
      : { name: config.name, textEffects: textEffectsConfig };
  const result = await manager.createTextEffect(sheetId, config.text, position, {
    ...options,
  });

  // Emit textEffectsCreated event
  emitEvent(ctx, {
    type: 'textEffectsCreated',
    timestamp: Date.now(),
    payload: {
      objectId: result.id,
      sheetId,
      config: result.textEffects ?? textEffectsConfig,
    },
    source: 'user',
  });

  return result.id;
}

/**
 * Delete a TextEffect object from a sheet.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function deleteTextEffect(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;
  const objSheetId = textBox.sheetId;

  await manager.deleteObject(objectId);

  // Emit textEffectsRemoved event
  emitEvent(ctx, {
    type: 'textEffectsRemoved',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: objSheetId,
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update the warp preset of a TextEffect object.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectWarp(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  warp: TextWarpPreset,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;

  await manager.updateTextEffect(objectId, { warpPreset: warp });

  // Emit textEffectsUpdated event
  emitEvent(ctx, {
    type: 'textEffectsUpdated',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: textBox.sheetId,
      changes: { warpPreset: warp },
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update the fill of a TextEffect object.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectFill(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  fill: NonNullable<TextEffectUpdates['fill']>,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;

  await manager.updateTextEffect(objectId, { fill });

  // Emit textEffectsUpdated event
  emitEvent(ctx, {
    type: 'textEffectsUpdated',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: textBox.sheetId,
      changes: { fill },
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update the outline of a TextEffect object.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectOutline(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  outline: TextEffectUpdates['outline'],
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;

  await manager.updateTextEffect(objectId, { outline });

  // Emit textEffectsUpdated event
  emitEvent(ctx, {
    type: 'textEffectsUpdated',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: textBox.sheetId,
      changes: { outline },
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update the effects of a TextEffect object (shadow, glow, reflection, etc.).
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectEffects(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  effects: NonNullable<TextEffectUpdates['effects']>,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;

  await manager.updateTextEffect(objectId, { effects });

  // Emit textEffectsUpdated event
  emitEvent(ctx, {
    type: 'textEffectsUpdated',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: textBox.sheetId,
      changes: { effects },
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update the text content of a TextEffect object.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectText(
  manager: SpreadsheetObjectManager,
  _ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  text: string,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  // Update the text box content (not the TextEffect config itself)
  await manager.updateObject(objectId, { ...textBox, text: { ...textBox.text, content: text } });
}

/**
 * Batch update all TextEffect configuration properties.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectConfig(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  config: TextEffectConfigUpdate,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;

  await manager.updateTextEffect(objectId, config);

  // Emit textEffectsUpdated event
  emitEvent(ctx, {
    type: 'textEffectsUpdated',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: textBox.sheetId,
      changes: config,
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Update text formatting of a TextEffect object (bold, italic, fontSize, etc.).
 * Throws KernelError if the TextEffect does not exist.
 */
export async function updateTextEffectTextFormat(
  manager: SpreadsheetObjectManager,
  _ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  format: TextEffectTextFormatUpdate,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  // Merge with existing text format.
  const currentFormat = textBox.text?.format ?? {};
  const updatedFormat = { ...currentFormat, ...format };
  await manager.updateObject(objectId, {
    ...textBox,
    text: { ...textBox.text, content: textBox.text?.content ?? '', format: updatedFormat },
  });
}

/**
 * Convert a regular text box to TextEffect by applying TextEffect styling.
 * Throws KernelError if the object is not a textbox.
 */
export async function convertToTextEffect(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
  warpPreset?: TextWarpPreset,
): Promise<void> {
  const obj = await manager.getObject(objectId);
  if (!obj || obj.type !== 'textbox') {
    throw textEffectNotFound(objectId);
  }

  // If already has TextEffect config, treat as no-op success
  if (obj.textEffects) {
    return;
  }

  const textEffectsConfig = createDefaultApiTextEffectConfig(warpPreset);

  await manager.convertToTextEffect(objectId, textEffectsConfig);

  // Emit textEffectsConverted event
  emitEvent(ctx, {
    type: 'textEffectsConverted',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: obj.sheetId,
      config: textEffectsConfig,
    },
    source: 'user',
  });
}

/**
 * Convert TextEffect back to a regular text box by removing TextEffect styling.
 * Text content is preserved.
 * Throws KernelError if the TextEffect does not exist.
 */
export async function convertToTextBox(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  objectId: string,
): Promise<void> {
  const textBox = await requireTextEffect(manager, objectId);
  const previousConfig = textBox.textEffects;
  const objSheetId = textBox.sheetId;

  await manager.removeTextEffectStyling(objectId);

  // Emit textEffectsRemoved event (removing TextEffect from text box)
  emitEvent(ctx, {
    type: 'textEffectsRemoved',
    timestamp: Date.now(),
    payload: {
      objectId,
      sheetId: objSheetId,
      previousConfig,
    },
    source: 'user',
  });
}

/**
 * Unified update method for TextEffect. Dispatches to the appropriate sub-update
 * based on which fields are set in `updates`. This is the method the Worksheet API
 * should call.
 * Throws KernelError if the TextEffect does not exist or any sub-update fails.
 */
export async function updateTextEffect(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  updates: TextEffectUpdates,
): Promise<void> {
  // Verify object exists upfront
  await requireTextEffect(manager, objectId);

  // Apply text content update
  if (updates.text !== undefined) {
    await updateTextEffectText(manager, ctx, sheetId, objectId, updates.text);
  }

  // Apply warp preset update
  if (updates.warp !== undefined) {
    await updateTextEffectWarp(manager, ctx, sheetId, objectId, updates.warp);
  }

  // Apply fill update
  if (updates.fill !== undefined) {
    await updateTextEffectFill(manager, ctx, sheetId, objectId, updates.fill);
  }

  // Apply outline update. Use presence so explicit undefined removes an outline.
  if ('outline' in updates) {
    await updateTextEffectOutline(manager, ctx, sheetId, objectId, updates.outline);
  }

  // Apply effects update
  if (updates.effects !== undefined) {
    await updateTextEffectEffects(manager, ctx, sheetId, objectId, updates.effects);
  }

  // Apply batch config update
  if (updates.config !== undefined) {
    await updateTextEffectConfig(manager, ctx, sheetId, objectId, updates.config);
  }

  // Apply text format update
  if (updates.textFormat !== undefined) {
    await updateTextEffectTextFormat(manager, ctx, sheetId, objectId, updates.textFormat);
  }

  // Apply warp adjustments update (if provided independently of warp preset)
  if (updates.warpAdjustments !== undefined && updates.warp === undefined) {
    await updateTextEffectConfig(manager, ctx, sheetId, objectId, {
      warpAdjustments: updates.warpAdjustments,
    });
  }
}
