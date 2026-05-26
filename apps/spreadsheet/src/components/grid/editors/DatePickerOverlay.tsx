import { useEffect, useMemo, useState } from 'react';

import { type ValidationRule } from '@mog-sdk/contracts/api';
import { displayString } from '@mog-sdk/contracts/core';
import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';
import { getDay, getMonth, getYear } from '@mog/spreadsheet-utils/datetime';

import { useActiveCell } from '../../../hooks/selection/use-active-cell';
import {
  useActiveSheetId,
  useFeatureGates,
  useReadOnly,
  useWorkbook,
} from '../../../infra/context';
import { useDispatch, useEditorActions, useEditorState, useRendererActions } from '../../../hooks';
import {
  getDatePickerEligibility,
  normalizeDateValidationBounds,
  type DatePickerEligibility,
} from '../../../domain/date-picker/eligibility';
import { DatePicker } from '../DatePicker';

function valueDisplayKind(
  value: unknown,
  hasFormula: boolean | undefined,
  error: string | undefined,
): 'blank' | 'number' | 'text' | 'formula' | 'error' | 'spill-child' {
  if (hasFormula) return 'formula';
  if (error) return 'error';
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  return 'text';
}

function serialToIso(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return '';
  return `${getYear(value)}-${String(getMonth(value)).padStart(2, '0')}-${String(getDay(value)).padStart(2, '0')}`;
}

function todayIsoInHostZone(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function DatePickerOverlay() {
  const editorState = useEditorState();
  const editorActions = useEditorActions();
  const rendererActions = useRendererActions();
  const dispatch = useDispatch();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const activeCell = useActiveCell().activeCell;
  const readOnly = useReadOnly();
  const featureGates = useFeatureGates();
  const enabled = featureGates.capabilities?.datePicker !== false;
  const [eligibility, setEligibility] = useState<DatePickerEligibility | null>(null);
  const [validationRule, setValidationRule] = useState<ValidationRule | null>(null);
  const [isAffordanceOpen, setAffordanceOpen] = useState(false);
  const [culture, setCulture] = useState('en-US');

  useEffect(() => {
    if (!enabled) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ws = workbook.getSheetById(activeSheetId);
      const data = ws.viewport.getCellData(activeCell.row, activeCell.col);
      const activeData = ws.viewport.getActiveCellData();
      const cachedRule = ws.validations.peek(activeCell.row, activeCell.col);
      const rule =
        cachedRule === undefined
          ? await ws.validations.get(activeCell.row, activeCell.col)
          : cachedRule;
      const settings = await workbook
        .getSettings()
        .catch(() => ({ culture: 'en-US', date1904: false }));
      if (cancelled) return;
      const value = data?.value ?? activeData?.value ?? null;
      const format =
        typeof activeData?.numberFormat === 'string'
          ? activeData.numberFormat
          : typeof (data?.format as { numberFormat?: unknown } | undefined)?.numberFormat ===
              'string'
            ? String((data?.format as { numberFormat?: unknown }).numberFormat)
            : null;
      const schemaType =
        data?.schema_type === 'date' ||
        data?.schema_type === 'datetime' ||
        data?.schema_type === 'time'
          ? data.schema_type
          : null;
      setCulture(settings.culture ?? 'en-US');
      setValidationRule(rule);
      setEligibility(
        getDatePickerEligibility({
          row: activeCell.row,
          col: activeCell.col,
          value,
          displayKind: valueDisplayKind(
            value,
            data?.hasFormula ?? Boolean(activeData?.formula),
            data?.error,
          ),
          resolvedNumberFormat: format,
          validationRule: rule,
          schemaType,
          protectedOrReadOnly: readOnly,
          dateSystem: settings.date1904 ? '1904' : '1900',
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCell.col, activeCell.row, activeSheetId, enabled, readOnly, workbook]);

  const isEditingDate = editorState.editorType === 'date';
  const overlayCell = editorState.editingCell ?? activeCell;
  const shouldShowPicker =
    enabled && ((isEditingDate && editorState.isPickerOpen) || isAffordanceOpen);

  const cellRect = useMemo(() => {
    if (!overlayCell || !activeSheetId || !shouldShowPicker) return null;
    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;
    if (editorState.mergeBounds) {
      const rects = geometry.getRangePageRects(editorState.mergeBounds);
      return rects[0] ?? null;
    }
    return geometry.getCellPageRect({ row: overlayCell.row, col: overlayCell.col });
  }, [activeSheetId, editorState.mergeBounds, overlayCell, rendererActions, shouldShowPicker]);

  const affordanceRect = useMemo(() => {
    if (!enabled || !eligibility?.eligible || editorState.isEditing) return null;
    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;
    return geometry.getCellPageRect(activeCell);
  }, [activeCell, editorState.isEditing, eligibility, enabled, rendererActions]);

  const currentValue = useMemo(() => {
    const ws = workbook.getSheetById(activeSheetId);
    const data = ws.viewport.getCellData(overlayCell.row, overlayCell.col);
    if (typeof data?.value === 'number') return serialToIso(data.value);
    const text = data?.displayText ? displayString(data.displayText) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }, [activeSheetId, overlayCell.col, overlayCell.row, workbook]);

  const bounds = useMemo(() => normalizeDateValidationBounds(validationRule), [validationRule]);

  const openFromAffordance = async () => {
    const ws = workbook.getSheetById(activeSheetId);
    const data = ws.viewport.getCellData(activeCell.row, activeCell.col);
    const text = data?.displayText ? displayString(data.displayText) : '';
    const result = await editorActions.startEditing(
      activeCell,
      activeSheetId,
      text,
      'typing',
      undefined,
      true,
    );
    if (result.success) {
      setAffordanceOpen(true);
    }
  };

  const commit = (isoDate: string, direction: 'up' | 'down' | 'left' | 'right' | 'none') => {
    const kind = eligibility?.eligible ? eligibility.kind : isEditingDate ? 'date' : 'date';
    setAffordanceOpen(false);
    dispatch('DATE_PICKER_COMMIT', { isoDate, kind, direction });
  };

  return (
    <>
      {affordanceRect && (
        <button
          type="button"
          aria-label="Open date picker"
          data-date-picker-affordance
          className="absolute z-ss-overlay bg-ss-surface border border-ss-border rounded text-ss-text-secondary hover:bg-ss-surface-hover"
          style={{
            left: affordanceRect.x + affordanceRect.width - 18,
            top: affordanceRect.y + Math.max(2, (affordanceRect.height - 18) / 2),
            width: 16,
            height: 16,
            fontSize: 11,
            lineHeight: '14px',
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            void openFromAffordance();
          }}
        >
          ▾
        </button>
      )}
      <Popover
        open={shouldShowPicker && Boolean(cellRect)}
        onOpenChange={(open) => {
          if (!open) {
            setAffordanceOpen(false);
            editorActions.closePicker();
          }
        }}
      >
        {cellRect && (
          <PopoverAnchor
            virtualRef={{
              current: createVirtualRef(cellRect.x, cellRect.y + cellRect.height),
            }}
          />
        )}
        <PopoverContent
          side="bottom"
          align="start"
          shadow="lg"
          closeOnClickOutside={true}
          closeOnEscape={true}
          width={Math.max(cellRect?.width ?? 0, 248)}
        >
          <DatePicker
            currentValue={currentValue}
            todayIso={todayIsoInHostZone()}
            locale={culture}
            validationBounds={bounds}
            onCancel={() => {
              setAffordanceOpen(false);
              editorActions.closePicker();
            }}
            onSelect={commit}
            isOpen={shouldShowPicker}
            width={cellRect?.width ?? 248}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
