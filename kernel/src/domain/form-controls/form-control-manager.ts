/**
 * Form Control Manager
 *
 * Implements IFormControlManager from contracts with compute-backed storage.
 * Form controls are UI widgets for cells, NOT independent data stores.
 * The linked cell is the SINGLE SOURCE OF TRUTH for control values.
 *
 * Architecture:
 * - Rust floating-object storage is the undo/collaboration/persistence marker
 * - In-memory Map<string, FormControl> is a synchronous projection for overlays
 * - CellId-based anchors/links via Rust ComputeBridge.getOrCreateCellId()
 * - EventBus notifications for UI reactivity
 *
 * @see contracts/src/editor/form-controls.ts - Type contracts
 */

import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import {
  DEFAULT_COL_WIDTH_MACOS,
  DEFAULT_ROW_HEIGHT,
} from '@mog-sdk/contracts/rendering/constants';
import type {
  ButtonControl,
  CheckboxControl,
  ComboBoxControl,
  CreateButtonOptions,
  CreateCheckboxOptions,
  CreateComboBoxOptions,
  FormControl,
  IFormControlManager,
  ListBoxControl,
} from '@mog-sdk/contracts/form-controls';
import { parseCellAddress, parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { DocumentContext } from '../../context/types';
import type {
  FloatingObject as ComputeFloatingObject,
  FormControlOoxmlProps,
  MutationResult,
} from '../../bridges/compute/compute-types.gen';

type FormControlCellId = FormControl['anchor']['cellId'];
type FormControlCellAnchor = FormControl['anchor'];
type FormControlRangeRef = NonNullable<ComboBoxControl['itemsSourceRef']>;
type ComputeFormControlObject = Extract<ComputeFloatingObject, { type: 'formControl' }>;
type FloatingObjectEventLike = {
  sheetId: string;
  objectId: string;
  objectType?: unknown;
};

function formControlCellId(id: string): FormControlCellId {
  return toCellId(id) as unknown as FormControlCellId;
}

function mutationResultCellId(data: unknown): FormControlCellId {
  if (typeof data !== 'string') {
    throw new Error('Expected getOrCreateCellId mutation result data to be a CellId string');
  }
  return formControlCellId(data);
}

function mutationResultObjectId(result: MutationResult): string {
  const objectId =
    result.floatingObjectChanges?.find((change) => change.kind.type === 'created')?.objectId ??
    (typeof result.data === 'string' ? result.data : undefined);
  if (!objectId) {
    throw new Error('Expected createFloatingObject mutation result to include an object ID');
  }
  return objectId;
}

function mutationResultCreatedObject(result: MutationResult): ComputeFloatingObject | undefined {
  return result.floatingObjectChanges?.find((change) => change.kind.type === 'created')?.data;
}

type FormControlMutationKind = 'created' | 'updated' | 'deleted';
type FormControlMutationEvent = {
  type: `formControl:${FormControlMutationKind}`;
  timestamp: number;
  sheetId: SheetId;
  controlId: string;
  controlType: FormControl['type'];
  source: 'api';
  control?: FormControl;
  previousControl?: FormControl;
};

// =============================================================================
// Constants
// =============================================================================

/** Default checkbox dimensions (pixels) */
const DEFAULT_CHECKBOX_WIDTH = 16;
const DEFAULT_CHECKBOX_HEIGHT = 16;

/** Default button dimensions (pixels) */
const DEFAULT_BUTTON_WIDTH = 80;
const DEFAULT_BUTTON_HEIGHT = 28;

/** Default comboBox dimensions (pixels) */
const DEFAULT_COMBOBOX_WIDTH = 140;
const DEFAULT_COMBOBOX_HEIGHT = 28;

/** Default listBox dimensions (pixels) */
const DEFAULT_LISTBOX_WIDTH = 140;
const DEFAULT_LISTBOX_HEIGHT = 80;

const EMU_PER_PX = 9525;

function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

function emuToPx(emu: number | undefined): number {
  return (emu ?? 0) / EMU_PER_PX;
}

function controlOffsetToPx(value: number | undefined): number {
  const raw = value ?? 0;
  // Imported VML controls historically arrive through fields named *Emu
  // while carrying pixel offsets. Authored controls carry true EMUs.
  return Math.abs(raw) < EMU_PER_PX ? raw : emuToPx(raw);
}

function isFormControlObject(value: unknown): value is ComputeFormControlObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'formControl'
  );
}

function normalizeControlType(type: string): string {
  return type.replace(/\s+/g, '').toLowerCase();
}

function normalizeControlReference(ref: string | undefined): string | undefined {
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

function parseItemsSourceRefJson(inputRange: string | undefined): FormControlRangeRef | undefined {
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

function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function buildFormControlOoxmlProps(items: string[]): FormControlOoxmlProps {
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

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique form control ID.
 * Uses the same UUID v7 scheme as CellId for consistency.
 */
export function generateFormControlId(): string {
  return `fc-${crypto.randomUUID()}`;
}

// =============================================================================
// FormControlManager
// =============================================================================

/**
 * Manages form controls (Checkbox, Button, ComboBox) for a document.
 *
 * Storage:
 * - Rust floating-object storage keyed by control ID.
 * - In-memory Map<string, FormControl> keyed by control ID for synchronous reads.
 *
 * Cell Identity Model:
 * - Anchors use CellId (stable references that survive row/col changes).
 * - Position is resolved at render time, not stored redundantly.
 * - Linked cells use CellId for value binding.
 */
export class FormControlManager implements IFormControlManager {
  /** Synchronous projection: controlId -> FormControl */
  private readonly controls = new Map<string, FormControl>();

  /** Last-known deleted controls, used to restore the overlay on redo. */
  private readonly deletedControls = new Map<string, FormControl>();

  private readonly hydratedSheets = new Set<SheetId>();
  private readonly hydratingSheets = new Set<SheetId>();

  /** Store context for CellId resolution */
  private readonly ctx: DocumentContext;

  constructor(ctx: DocumentContext) {
    this.ctx = ctx;
    this.subscribeToFloatingObjectEvents();
  }

  // ---------------------------------------------------------------------------
  // Create Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a checkbox control.
   * Converts position-based anchors/links to CellId-based references.
   */
  async createCheckbox(options: CreateCheckboxOptions): Promise<CheckboxControl> {
    return this.withUndoGroup(async () => {
      const anchorCellId = await this.getOrCreateCellId(
        options.sheetId,
        options.anchor.row,
        options.anchor.col,
      );
      const linkedCellId = await this.getOrCreateCellId(
        options.sheetId,
        options.linkedCell.row,
        options.linkedCell.col,
      );

      const width = options.width ?? DEFAULT_CHECKBOX_WIDTH;
      const height = options.height ?? DEFAULT_CHECKBOX_HEIGHT;
      const result = await this.ctx.computeBridge.createFloatingObject(
        options.sheetId,
        this.buildFormControlObjectConfig({
          controlType: 'checkbox',
          anchor: options.anchor,
          anchorCellId,
          linkedCellId,
          label: options.label,
          width,
          height,
        }),
      );
      const created = mutationResultCreatedObject(result);
      const now = Date.now();
      const control: CheckboxControl = {
        id: mutationResultObjectId(result),
        type: 'checkbox',
        sheetId: options.sheetId,
        anchor: this.buildCellAnchor(anchorCellId, options.anchor),
        width,
        height,
        enabled: true,
        zIndex: created?.zIndex ?? this.getNextZIndex(options.sheetId),
        linkedCellId,
        label: options.label,
        createdAt: created?.createdAt ?? now,
        updatedAt: created?.updatedAt ?? now,
      };

      this.upsertControl(control, 'created');
      return control;
    });
  }

  /**
   * Create a button control.
   */
  async createButton(options: CreateButtonOptions): Promise<ButtonControl> {
    return this.withUndoGroup(async () => {
      const anchorCellId = await this.getOrCreateCellId(
        options.sheetId,
        options.anchor.row,
        options.anchor.col,
      );
      const linkedCellId = options.linkedCell
        ? await this.getOrCreateCellId(
            options.sheetId,
            options.linkedCell.row,
            options.linkedCell.col,
          )
        : undefined;

      const width = options.width ?? DEFAULT_BUTTON_WIDTH;
      const height = options.height ?? DEFAULT_BUTTON_HEIGHT;
      const result = await this.ctx.computeBridge.createFloatingObject(
        options.sheetId,
        this.buildFormControlObjectConfig({
          controlType: 'button',
          anchor: options.anchor,
          anchorCellId,
          linkedCellId,
          label: options.label,
          width,
          height,
        }),
      );
      const created = mutationResultCreatedObject(result);
      const now = Date.now();
      const control: ButtonControl = {
        id: mutationResultObjectId(result),
        type: 'button',
        sheetId: options.sheetId,
        anchor: this.buildCellAnchor(anchorCellId, options.anchor),
        width,
        height,
        enabled: true,
        zIndex: created?.zIndex ?? this.getNextZIndex(options.sheetId),
        label: options.label,
        linkedCellId,
        clickAction: options.clickAction,
        clickValue: options.clickValue,
        createdAt: created?.createdAt ?? now,
        updatedAt: created?.updatedAt ?? now,
      };

      this.upsertControl(control, 'created');
      return control;
    });
  }

  /**
   * Create a comboBox control.
   */
  async createComboBox(options: CreateComboBoxOptions): Promise<ComboBoxControl> {
    return this.withUndoGroup(async () => {
      const anchorCellId = await this.getOrCreateCellId(
        options.sheetId,
        options.anchor.row,
        options.anchor.col,
      );
      const linkedCellId = await this.getOrCreateCellId(
        options.sheetId,
        options.linkedCell.row,
        options.linkedCell.col,
      );

      // Convert position-based itemsSource to CellId-based IdentityRangeRef
      let itemsSourceRef: FormControlRangeRef | undefined;
      if (options.itemsSource) {
        const startId = await this.getOrCreateCellId(
          options.sheetId,
          options.itemsSource.startRow,
          options.itemsSource.startCol,
        );
        const endId = await this.getOrCreateCellId(
          options.sheetId,
          options.itemsSource.endRow,
          options.itemsSource.endCol,
        );
        itemsSourceRef = {
          type: 'range',
          startId,
          endId,
          startRowAbsolute: true,
          startColAbsolute: true,
          endRowAbsolute: true,
          endColAbsolute: true,
        };
      }

      const width = options.width ?? DEFAULT_COMBOBOX_WIDTH;
      const height = options.height ?? DEFAULT_COMBOBOX_HEIGHT;
      const result = await this.ctx.computeBridge.createFloatingObject(
        options.sheetId,
        this.buildFormControlObjectConfig({
          controlType: 'comboBox',
          anchor: options.anchor,
          anchorCellId,
          linkedCellId,
          label: options.placeholder,
          width,
          height,
          items: options.items,
          itemsSourceRef,
        }),
      );
      const created = mutationResultCreatedObject(result);
      const now = Date.now();
      const control: ComboBoxControl = {
        id: mutationResultObjectId(result),
        type: 'comboBox',
        sheetId: options.sheetId,
        anchor: this.buildCellAnchor(anchorCellId, options.anchor),
        width,
        height,
        enabled: true,
        zIndex: created?.zIndex ?? this.getNextZIndex(options.sheetId),
        linkedCellId,
        items: options.items,
        itemsSourceRef,
        placeholder: options.placeholder,
        createdAt: created?.createdAt ?? now,
        updatedAt: created?.updatedAt ?? now,
      };

      this.upsertControl(control, 'created');
      return control;
    });
  }

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a form control by ID.
   */
  getControl(controlId: string): FormControl | undefined {
    return this.controls.get(controlId);
  }

  /**
   * Get all form controls for a sheet.
   */
  getControlsForSheet(sheetId: SheetId): FormControl[] {
    this.ensureHydratedForSheet(sheetId);
    const result: FormControl[] = [];
    for (const control of this.controls.values()) {
      if (control.sheetId === sheetId) {
        result.push(control);
      }
    }
    return result;
  }

  /**
   * Get all form controls in the document.
   */
  getAllControls(): FormControl[] {
    return Array.from(this.controls.values());
  }

  // ---------------------------------------------------------------------------
  // Update Operations
  // ---------------------------------------------------------------------------

  /**
   * Update a form control's properties.
   * Does NOT update the linked cell value - use SpreadsheetStore for that.
   */
  updateControl(
    controlId: string,
    updates: Partial<Omit<FormControl, 'id' | 'type' | 'sheetId'>>,
  ): void {
    const control = this.controls.get(controlId);
    if (!control) return;

    const updated = { ...control, ...updates, updatedAt: Date.now() } as FormControl;
    this.controls.set(controlId, updated);
    this.persistControlUpdate(controlId, this.formControlToFloatingObjectUpdates(updated));
    this.emitFormControlEvent('updated', updated, control);
  }

  /**
   * Move a control to a new anchor position.
   */
  async moveControl(
    controlId: string,
    newAnchor: { row: number; col: number; xOffset?: number; yOffset?: number },
  ): Promise<void> {
    const control = this.controls.get(controlId);
    if (!control) return;

    const anchorCellId = await this.getOrCreateCellId(
      control.sheetId,
      newAnchor.row,
      newAnchor.col,
    );
    const anchor: FormControlCellAnchor = {
      cellId: anchorCellId,
      xOffset: newAnchor.xOffset ?? 0,
      yOffset: newAnchor.yOffset ?? 0,
    };

    const updated = { ...control, anchor, updatedAt: Date.now() } as FormControl;
    this.controls.set(controlId, updated);
    await this.ctx.computeBridge.updateFloatingObject(control.sheetId, controlId, {
      anchor: {
        anchorRow: newAnchor.row,
        anchorCol: newAnchor.col,
        anchorRowOffsetEmu: pxToEmu(newAnchor.yOffset ?? 0),
        anchorColOffsetEmu: pxToEmu(newAnchor.xOffset ?? 0),
        anchorMode: 'oneCell',
        extentCxEmu: pxToEmu(control.width),
        extentCyEmu: pxToEmu(control.height),
      },
      anchorCellId,
    });
    this.emitFormControlEvent('updated', updated, control);
  }

  /**
   * Resize a control.
   */
  resizeControl(controlId: string, width: number, height: number): void {
    const control = this.controls.get(controlId);
    if (!control) return;

    const updated = { ...control, width, height, updatedAt: Date.now() } as FormControl;
    this.controls.set(controlId, updated);
    this.persistControlUpdate(controlId, {
      width,
      height,
      extentCxEmu: pxToEmu(width),
      extentCyEmu: pxToEmu(height),
    });
    this.emitFormControlEvent('updated', updated, control);
  }

  // ---------------------------------------------------------------------------
  // Delete Operations
  // ---------------------------------------------------------------------------

  /**
   * Delete a form control.
   */
  deleteControl(controlId: string): void {
    const control = this.controls.get(controlId);
    if (!control) return;
    this.removeControlFromCache(controlId, true);
    void this.ctx.computeBridge.deleteFloatingObject(control.sheetId, controlId);
  }

  /**
   * Delete all form controls for a sheet.
   */
  deleteControlsForSheet(sheetId: SheetId): void {
    for (const [id, control] of this.controls) {
      if (control.sheetId === sheetId) {
        this.removeControlFromCache(id, true);
        void this.ctx.computeBridge.deleteFloatingObject(control.sheetId, id);
      }
    }
  }

  /**
   * Clear all form controls. Used during workbook dispose.
   */
  clear(): void {
    for (const control of this.controls.values()) {
      this.emitFormControlEvent('deleted', control);
    }
    this.controls.clear();
    this.deletedControls.clear();
    this.hydratedSheets.clear();
    this.hydratingSheets.clear();
  }

  // ---------------------------------------------------------------------------
  // Utility Operations
  // ---------------------------------------------------------------------------

  /**
   * Check if a linked cell still exists.
   * Returns true if cell exists, false if deleted.
   */
  isLinkedCellValid(controlId: string): boolean {
    const control = this.controls.get(controlId);
    if (!control) return false;

    // Check if the control type has a linkedCellId
    if (control.type === 'checkbox' || control.type === 'comboBox' || control.type === 'listBox') {
      return control.linkedCellId !== undefined && control.linkedCellId !== '';
    }
    if (control.type === 'button') {
      // Buttons have optional linkedCellId, so valid if it exists or if there's none
      return true;
    }

    return false;
  }

  /**
   * Get controls at a specific position (for hit testing).
   *
   * NOTE: This performs exact anchor-cell matching. For pixel-level hit testing
   * with control dimensions, the rendering layer should resolve CellId anchors
   * to pixel positions and check bounding boxes.
   */
  getControlsAtPosition(sheetId: SheetId, _row: number, _col: number): FormControl[] {
    const result: FormControl[] = [];

    for (const control of this.controls.values()) {
      if (control.sheetId !== sheetId) continue;

      // For exact anchor matching, we need to resolve the CellId to position.
      // Since CellId resolution is async (ComputeBridge), we use a sync check:
      // Check if any control has an anchor that was created for this position.
      // Full pixel-level hit testing is done in the rendering layer.
      //
      // For now, we check against all controls for the sheet and let the
      // rendering layer do precise hit testing with resolved positions.
      // This is a best-effort sync implementation.
      result.push(control);
    }

    // Return all controls for the sheet - rendering layer filters by position
    return this.getControlsForSheet(sheetId);
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the next z-index for a new control on a sheet.
   * Returns max existing zIndex + 1, or 0 if no controls exist.
   */
  private getNextZIndex(sheetId: SheetId): number {
    let maxZ = -1;
    for (const control of this.controls.values()) {
      if (control.sheetId === sheetId && control.zIndex > maxZ) {
        maxZ = control.zIndex;
      }
    }
    return maxZ + 1;
  }

  /**
   * Get or create a CellId for the given position.
   * Delegates to Rust via ComputeBridge — Rust is the sole authority for CellId generation.
   */
  private async getOrCreateCellId(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<FormControlCellId> {
    // Check existing first
    const existing = await this.ctx.computeBridge.getCellIdAt(sheetId, row, col);
    if (existing) {
      return formControlCellId(existing);
    }
    // Rust generates CellId and creates marker cell
    const result = await this.ctx.computeBridge.getOrCreateCellId(sheetId, row, col);
    return mutationResultCellId(result.data);
  }

  private async withUndoGroup<T>(fn: () => Promise<T>): Promise<T> {
    await this.ctx.computeBridge.beginUndoGroup();
    try {
      return await fn();
    } finally {
      await this.ctx.computeBridge.endUndoGroup();
    }
  }

  private buildCellAnchor(
    cellId: FormControlCellId,
    anchor: { xOffset?: number; yOffset?: number },
  ): FormControlCellAnchor {
    return {
      cellId,
      xOffset: anchor.xOffset ?? 0,
      yOffset: anchor.yOffset ?? 0,
    };
  }

  private async resolveCellLink(
    sheetId: SheetId,
    ref: string | undefined,
  ): Promise<FormControlCellId | undefined> {
    const normalized = normalizeControlReference(ref);
    if (!normalized) return undefined;

    const parsed = parseCellAddress(normalized);
    if (parsed) {
      return await this.getOrCreateCellId(sheetId, parsed.row, parsed.col);
    }

    return formControlCellId(normalized);
  }

  private async parseItemsSourceRef(
    sheetId: SheetId,
    inputRange: string | undefined,
  ): Promise<FormControlRangeRef | undefined> {
    const jsonRef = parseItemsSourceRefJson(inputRange);
    if (jsonRef) return jsonRef;

    const normalized = normalizeControlReference(inputRange);
    if (!normalized) return undefined;
    const range = parseCellRange(normalized);
    if (!range) return undefined;

    const startId = await this.getOrCreateCellId(sheetId, range.startRow, range.startCol);
    const endId = await this.getOrCreateCellId(sheetId, range.endRow, range.endCol);
    return {
      type: 'range',
      startId,
      endId,
      startRowAbsolute: true,
      startColAbsolute: true,
      endRowAbsolute: true,
      endColAbsolute: true,
    };
  }

  private resolveImportedDimensions(
    object: ComputeFormControlObject,
    defaults: { width: number; height: number },
  ): { width: number; height: number } {
    let width = object.width;
    let height = object.height;
    const anchor = object.anchor;

    if ((width == null || width <= 0) && anchor.endCol != null) {
      const fromX =
        anchor.anchorCol * DEFAULT_COL_WIDTH_MACOS + controlOffsetToPx(anchor.anchorColOffsetEmu);
      const toX =
        anchor.endCol * DEFAULT_COL_WIDTH_MACOS + controlOffsetToPx(anchor.endColOffsetEmu);
      width = Math.abs(toX - fromX);
    }

    if ((height == null || height <= 0) && anchor.endRow != null) {
      const fromY =
        anchor.anchorRow * DEFAULT_ROW_HEIGHT + controlOffsetToPx(anchor.anchorRowOffsetEmu);
      const toY = anchor.endRow * DEFAULT_ROW_HEIGHT + controlOffsetToPx(anchor.endRowOffsetEmu);
      height = Math.abs(toY - fromY);
    }

    return {
      width: width > 0 ? width : defaults.width,
      height: height > 0 ? height : defaults.height,
    };
  }

  private extractImportedLabel(object: ComputeFormControlObject, fallback: string): string {
    if (object.name) return object.name;
    const content = (object.ooxml?.vmlShape as { textboxContent?: unknown } | null | undefined)
      ?.textboxContent;
    if (typeof content !== 'string') return fallback;
    const text = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    return text || fallback;
  }

  private buildFormControlObjectConfig(options: {
    controlType: 'checkbox' | 'button' | 'comboBox';
    anchor: { row: number; col: number; xOffset?: number; yOffset?: number };
    anchorCellId: FormControlCellId;
    linkedCellId?: FormControlCellId;
    label?: string;
    width: number;
    height: number;
    items?: string[];
    itemsSourceRef?: FormControlRangeRef;
  }): Record<string, unknown> {
    return omitUndefined({
      type: 'formControl',
      controlType: options.controlType,
      cellLink: options.linkedCellId,
      inputRange: options.itemsSourceRef ? JSON.stringify(options.itemsSourceRef) : undefined,
      ooxml: options.items ? buildFormControlOoxmlProps(options.items) : undefined,
      anchor: {
        anchorRow: options.anchor.row,
        anchorCol: options.anchor.col,
        anchorRowOffsetEmu: pxToEmu(options.anchor.yOffset ?? 0),
        anchorColOffsetEmu: pxToEmu(options.anchor.xOffset ?? 0),
        anchorMode: 'oneCell',
        extentCxEmu: pxToEmu(options.width),
        extentCyEmu: pxToEmu(options.height),
      },
      anchorCellId: options.anchorCellId,
      width: options.width,
      height: options.height,
      name: options.label,
    });
  }

  private formControlToFloatingObjectUpdates(control: FormControl): Record<string, unknown> {
    const updates: Record<string, unknown> = omitUndefined({
      width: control.width,
      height: control.height,
      extentCxEmu: pxToEmu(control.width),
      extentCyEmu: pxToEmu(control.height),
      name:
        control.name ??
        (control.type === 'comboBox'
          ? control.placeholder
          : 'label' in control
            ? control.label
            : undefined),
    });
    if (
      control.type === 'checkbox' ||
      control.type === 'comboBox' ||
      control.type === 'listBox' ||
      control.type === 'button'
    ) {
      updates.cellLink = control.linkedCellId;
    }
    if (control.type === 'comboBox' || control.type === 'listBox') {
      updates.inputRange = control.itemsSourceRef
        ? JSON.stringify(control.itemsSourceRef)
        : undefined;
      updates.ooxml = control.items ? buildFormControlOoxmlProps(control.items) : undefined;
    }
    return updates;
  }

  private persistControlUpdate(controlId: string, updates: Record<string, unknown>): void {
    const control = this.controls.get(controlId);
    if (!control) return;
    void this.ctx.computeBridge.updateFloatingObject(control.sheetId, controlId, updates);
  }

  private upsertControl(control: FormControl, createdKind: 'created' | 'updated'): void {
    const previous = this.controls.get(control.id);
    this.controls.set(control.id, control);
    this.deletedControls.delete(control.id);
    if (previous) {
      this.emitFormControlEvent('updated', control, previous);
    } else {
      this.emitFormControlEvent(createdKind, control);
    }
  }

  private removeControlFromCache(controlId: string, keepRedoSnapshot: boolean): void {
    const control = this.controls.get(controlId);
    if (!control) return;
    this.controls.delete(controlId);
    if (keepRedoSnapshot) {
      this.deletedControls.set(controlId, control);
    }
    this.emitFormControlEvent('deleted', control);
  }

  private subscribeToFloatingObjectEvents(): void {
    this.ctx.eventBus.on('floatingObject:created', (rawEvent) => {
      const event = rawEvent as FloatingObjectEventLike;
      if (event.objectType === 'formControl') {
        void this.syncControlFromFloatingObject(toSheetId(event.sheetId), event.objectId);
      }
    });
    this.ctx.eventBus.on('floatingObject:updated', (rawEvent) => {
      const event = rawEvent as FloatingObjectEventLike;
      const deleted = this.deletedControls.get(event.objectId);
      if (deleted) {
        this.upsertControl({ ...deleted, updatedAt: Date.now() } as FormControl, 'created');
        return;
      }
      if (event.objectType === 'formControl') {
        void this.syncControlFromFloatingObject(toSheetId(event.sheetId), event.objectId);
      }
    });
    this.ctx.eventBus.on('floatingObject:deleted', (rawEvent) => {
      const event = rawEvent as FloatingObjectEventLike;
      this.removeControlFromCache(event.objectId, true);
    });
  }

  private ensureHydratedForSheet(sheetId: SheetId): void {
    if (this.hydratedSheets.has(sheetId) || this.hydratingSheets.has(sheetId)) return;
    this.hydratingSheets.add(sheetId);
    void this.ctx.computeBridge
      .getFloatingObjectsInSheet(sheetId)
      .then(async (objects) => {
        await Promise.all(
          objects
            .filter(([, value]) => isFormControlObject(value))
            .map(([objectId]) => this.syncControlFromFloatingObject(sheetId, objectId)),
        );
        this.hydratedSheets.add(sheetId);
      })
      .finally(() => {
        this.hydratingSheets.delete(sheetId);
      });
  }

  private async syncControlFromFloatingObject(sheetId: SheetId, objectId: string): Promise<void> {
    const object = await this.ctx.computeBridge.getFloatingObjectTyped(sheetId, objectId);
    const control = await this.controlFromFloatingObject(object);
    if (control) {
      this.upsertControl(control, 'created');
    }
  }

  private async controlFromFloatingObject(
    object: ComputeFloatingObject | null,
  ): Promise<FormControl | null> {
    if (!isFormControlObject(object)) return null;

    const sheetId = toSheetId(object.sheetId);
    const anchorCellId = object.anchorCellId
      ? formControlCellId(object.anchorCellId)
      : await this.getOrCreateCellId(sheetId, object.anchor.anchorRow, object.anchor.anchorCol);

    const base = {
      id: object.id,
      sheetId,
      anchor: {
        cellId: anchorCellId,
        xOffset: controlOffsetToPx(object.anchor.anchorColOffsetEmu),
        yOffset: controlOffsetToPx(object.anchor.anchorRowOffsetEmu),
      },
      enabled: true,
      zIndex: object.zIndex,
      name: object.name || undefined,
      createdAt: object.createdAt,
      updatedAt: object.updatedAt,
    };

    const controlType = normalizeControlType(object.controlType);
    if (controlType === 'checkbox') {
      const linkedCellId = await this.resolveCellLink(sheetId, object.cellLink);
      if (!linkedCellId) return null;
      const dimensions = this.resolveImportedDimensions(object, {
        width: DEFAULT_CHECKBOX_WIDTH,
        height: DEFAULT_CHECKBOX_HEIGHT,
      });
      return {
        ...base,
        ...dimensions,
        type: 'checkbox',
        linkedCellId,
        label: object.name || this.extractImportedLabel(object, '') || undefined,
      };
    }
    if (controlType === 'drop' || controlType === 'combobox') {
      const linkedCellId = await this.resolveCellLink(sheetId, object.cellLink);
      if (!linkedCellId) return null;
      const dimensions = this.resolveImportedDimensions(object, {
        width: DEFAULT_COMBOBOX_WIDTH,
        height: DEFAULT_COMBOBOX_HEIGHT,
      });
      return {
        ...base,
        ...dimensions,
        type: 'comboBox',
        linkedCellId,
        items: object.ooxml?.items,
        itemsSourceRef: await this.parseItemsSourceRef(sheetId, object.inputRange),
        placeholder: object.name || undefined,
      };
    }
    if (controlType === 'list' || controlType === 'listbox') {
      const linkedCellId = await this.resolveCellLink(sheetId, object.cellLink);
      if (!linkedCellId) return null;
      const dimensions = this.resolveImportedDimensions(object, {
        width: DEFAULT_LISTBOX_WIDTH,
        height: DEFAULT_LISTBOX_HEIGHT,
      });
      const control: ListBoxControl = {
        ...base,
        ...dimensions,
        type: 'listBox',
        linkedCellId,
        items: object.ooxml?.items,
        itemsSourceRef: await this.parseItemsSourceRef(sheetId, object.inputRange),
        multiSelect: object.ooxml?.multiSel ?? undefined,
      };
      return control;
    }
    if (controlType === 'button') {
      const dimensions = this.resolveImportedDimensions(object, {
        width: DEFAULT_BUTTON_WIDTH,
        height: DEFAULT_BUTTON_HEIGHT,
      });
      return {
        ...base,
        ...dimensions,
        type: 'button',
        label: this.extractImportedLabel(object, 'Button'),
        linkedCellId: await this.resolveCellLink(sheetId, object.cellLink),
        actionId: object.ooxml?.macroName ?? undefined,
      };
    }
    return null;
  }

  private emitFormControlEvent(
    kind: FormControlMutationKind,
    control: FormControl,
    previousControl?: FormControl,
  ): void {
    const event: FormControlMutationEvent = {
      type: `formControl:${kind}`,
      timestamp: Date.now(),
      sheetId: control.sheetId,
      controlId: control.id,
      controlType: control.type,
      source: 'api',
      ...(kind !== 'deleted' ? { control } : {}),
      ...(kind === 'deleted' ? { previousControl: control } : {}),
      ...(previousControl ? { previousControl } : {}),
    };
    this.ctx.eventBus.emit(event as unknown as Parameters<DocumentContext['eventBus']['emit']>[0]);
  }
}
