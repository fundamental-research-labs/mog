import { jest } from '@jest/globals';

import {
  isPickerBackedValidation,
  peekValidationEditorConfig,
  resolveEditorType,
  validationRuleToCellSchema,
} from '../editor-validation-resolution';

describe('editor validation resolution', () => {
  it('treats empty inline lists as picker-backed dropdowns', () => {
    const ws = {
      validations: {
        peek: jest.fn(() => ({
          type: 'list',
          values: [],
          showDropdown: true,
          allowBlank: true,
        })),
      },
    } as any;

    expect(peekValidationEditorConfig(ws, 0, 0)).toEqual({
      state: 'ready',
      config: {
        editorType: 'dropdown',
        cellSchema: {
          type: 'string',
          constraints: { allowBlank: true, enum: [] },
        },
        enumItems: [],
      },
    });
  });

  it('suppresses picker editor type when showDropdown is false', () => {
    const rule = {
      type: 'list',
      values: ['Red', 'Green'],
      showDropdown: false,
      allowBlank: true,
    } as any;

    expect(isPickerBackedValidation(rule)).toBe(false);
    expect(resolveEditorType(rule)).toBe('text');
    expect(validationRuleToCellSchema(rule)).toEqual({
      type: 'string',
      constraints: { allowBlank: true, enum: ['Red', 'Green'] },
    });
  });

  it('returns cold for range-backed list validation until dropdown items hydrate', () => {
    const ws = {
      validations: {
        peek: jest.fn(() => ({
          type: 'list',
          listSource: '=A1:A3',
          showDropdown: true,
          allowBlank: true,
        })),
      },
    } as any;

    expect(peekValidationEditorConfig(ws, 0, 0)).toEqual({ state: 'cold' });
  });

  it('maps date validation to the date editor and date schema', () => {
    const rule = {
      type: 'date',
      operator: 'between',
      formula1: '2026-01-01',
      formula2: '2026-01-31',
      allowBlank: false,
    } as any;

    expect(isPickerBackedValidation(rule)).toBe(true);
    expect(resolveEditorType(rule)).toBe('date');
    expect(validationRuleToCellSchema(rule)).toMatchObject({
      type: 'date',
      constraints: {
        required: true,
        min: expect.any(Number),
        max: expect.any(Number),
      },
    });
  });
});
