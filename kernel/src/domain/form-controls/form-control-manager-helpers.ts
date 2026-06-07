import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { ComboBoxControl, FormControl } from '@mog-sdk/contracts/form-controls';

import type {
  FloatingObject as ComputeFloatingObject,
  FormControlOoxmlProps,
  MutationResult,
} from '../../bridges/compute/compute-types.gen';

export type FormControlCellId = FormControl['anchor']['cellId'];
export type FormControlRangeRef = NonNullable<ComboBoxControl['itemsSourceRef']>;
export type ComputeFormControlObject = Extract<ComputeFloatingObject, { type: 'formControl' }>;

export const DEFAULT_CHECKBOX_WIDTH = 16;
export const DEFAULT_CHECKBOX_HEIGHT = 16;
export const DEFAULT_BUTTON_WIDTH = 80;
export const DEFAULT_BUTTON_HEIGHT = 28;
export const DEFAULT_COMBOBOX_WIDTH = 140;
export const DEFAULT_COMBOBOX_HEIGHT = 28;
export const DEFAULT_LISTBOX_WIDTH = 140;
export const DEFAULT_LISTBOX_HEIGHT = 80;
export const DEFAULT_SCROLLBAR_WIDTH = 120;
export const DEFAULT_SCROLLBAR_HEIGHT = 20;
export const DEFAULT_SPINNER_WIDTH = 18;
export const DEFAULT_SPINNER_HEIGHT = 36;
export const DEFAULT_SLIDER_WIDTH = 120;
export const DEFAULT_SLIDER_HEIGHT = 24;

export const EMU_PER_PX = 9525;

export function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

function emuToPx(emu: number | undefined): number {
  return (emu ?? 0) / EMU_PER_PX;
}

export function controlOffsetToPx(value: number | undefined): number {
  const raw = value ?? 0;
  return Math.abs(raw) < EMU_PER_PX ? raw : emuToPx(raw);
}

export function formControlCellId(id: string): FormControlCellId {
  return toCellId(id) as unknown as FormControlCellId;
}

export function mutationResultCellId(data: unknown): FormControlCellId {
  if (typeof data !== 'string') {
    throw new Error('Expected getOrCreateCellId mutation result data to be a CellId string');
  }
  return formControlCellId(data);
}

export function mutationResultObjectId(result: MutationResult): string {
  const objectId =
    result.floatingObjectChanges?.find((change) => change.kind.type === 'created')?.objectId ??
    (typeof result.data === 'string' ? result.data : undefined);
  if (!objectId) {
    throw new Error('Expected createFloatingObject mutation result to include an object ID');
  }
  return objectId;
}

export function mutationResultCreatedObject(
  result: MutationResult,
): ComputeFloatingObject | undefined {
  return result.floatingObjectChanges?.find((change) => change.kind.type === 'created')?.data;
}

export function isFormControlObject(value: unknown): value is ComputeFormControlObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'formControl'
  );
}

export function normalizeControlType(type: string): string {
  return type.replace(/\s+/g, '').toLowerCase();
}

export function hasLinkedCell(
  control: FormControl,
): control is FormControl & { linkedCellId: string } {
  return (
    'linkedCellId' in control &&
    typeof control.linkedCellId === 'string' &&
    control.linkedCellId !== ''
  );
}

export function normalizeControlReference(ref: string | undefined): string | undefined {
  let normalized = ref?.trim();
  if (!normalized) return undefined;
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.startsWith('=')) {
    normalized = normalized.slice(1);
  }
  return normalized.trim() || undefined;
}

export function parseItemsSourceRefJson(
  inputRange: string | undefined,
): FormControlRangeRef | undefined {
  if (!inputRange?.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(inputRange) as Partial<FormControlRangeRef>;
    if (parsed.type === 'range' && parsed.startId && parsed.endId) {
      return {
        type: 'range',
        startId: formControlCellId(parsed.startId),
        endId: formControlCellId(parsed.endId),
        startRowAbsolute: parsed.startRowAbsolute ?? true,
        startColAbsolute: parsed.startColAbsolute ?? true,
        endRowAbsolute: parsed.endRowAbsolute ?? true,
        endColAbsolute: parsed.endColAbsolute ?? true,
      };
    }
  } catch {
    // Non-JSON input ranges are valid OOXML-style form-control metadata.
  }
  return undefined;
}

export function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

export function buildFormControlOoxmlProps(items: string[]): FormControlOoxmlProps {
  return {
    shapeId: 0,
    altText: null,
    fmlaGroup: null,
    fmlaTxbx: null,
    checked: null,
    val: null,
    sel: null,
    min: null,
    max: null,
    inc: null,
    page: null,
    dropLines: null,
    dropStyle: null,
    dx: null,
    horiz: false,
    colored: false,
    noThreeD: false,
    noThreeD2: false,
    firstButton: false,
    lockText: false,
    selType: null,
    multiSel: null,
    textHAlign: null,
    textVAlign: null,
    editVal: null,
    multiLine: false,
    verticalBar: false,
    passwordEdit: false,
    justLastX: false,
    widthMin: null,
    items,
    macroName: null,
    anchorSource: '',
    moveWithCells: true,
    sizeWithCells: true,
    vmlExtras: {},
    controlPrAttrs: {},
    vmlShape: null,
  };
}
