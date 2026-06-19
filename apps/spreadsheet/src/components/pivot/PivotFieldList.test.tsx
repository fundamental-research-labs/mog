import { jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type {
  PivotField,
  PivotFieldPlacementFlat,
  PivotTableConfig,
} from '@mog-sdk/contracts/pivot';

import { PIVOT_AGGREGATE_FUNCTION_OPTIONS } from '../../systems/pivot';
import { PivotFieldList, type PivotFieldListProps } from './PivotFieldList';

function pid(id: string): PivotFieldPlacementFlat['placementId'] {
  return id as PivotFieldPlacementFlat['placementId'];
}

const fields: PivotField[] = [
  { id: 'Month', name: 'Month', sourceColumn: 0, dataType: 'string' },
  { id: 'Vendor', name: 'Vendor', sourceColumn: 1, dataType: 'string' },
  { id: 'Amount', name: 'Amount', sourceColumn: 2, dataType: 'number' },
  { id: 'Category', name: 'Category', sourceColumn: 3, dataType: 'string' },
];

function placement(
  partial: Omit<PivotFieldPlacementFlat, 'placementId'> & { placementId: string },
): PivotFieldPlacementFlat {
  return {
    ...partial,
    placementId: pid(partial.placementId),
  };
}

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: jest.fn((type: string, value: string) => {
      values.set(type, value);
    }),
    getData: jest.fn((type: string) => values.get(type) ?? ''),
  } as unknown as DataTransfer;
}

function setRect(element: Element, rect: Partial<DOMRect>): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: rect.width ?? 100,
      bottom: rect.height ?? 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
      ...rect,
    }),
  });
}

function renderList(
  overrides: Partial<PivotFieldListProps> & { placements?: PivotTableConfig['placements'] } = {},
) {
  const props: PivotFieldListProps = {
    fields,
    placements: [
      placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
      placement({ placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 }),
      placement({
        placementId: 'value:Amount:0',
        fieldId: 'Amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      }),
    ],
    onAddField: jest.fn(),
    onRemovePlacement: jest.fn(),
    onMovePlacement: jest.fn(),
    onAggregateChange: jest.fn(),
    onSortOrderChange: jest.fn(),
    onValueSortChange: jest.fn(),
    ...overrides,
  };
  return { ...render(<PivotFieldList {...props} />), props };
}

function zone(container: HTMLElement, area: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-pivot-target="field-zone"][data-pivot-zone="${area}"]`,
  );
  if (!element) throw new Error(`Missing ${area} zone`);
  return element;
}

function chip(container: HTMLElement, placementId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-pivot-target="field-chip"][data-pivot-placement-id="${placementId}"]`,
  );
  if (!element) throw new Error(`Missing chip ${placementId}`);
  return element;
}

describe('PivotFieldList placement editor', () => {
  it('renders available source fields as full-width checkbox rows with stable selectors', () => {
    const { container } = renderList();
    const availableFields = container.querySelector<HTMLElement>(
      '[data-pivot-target="available-fields"][data-pivot-zone="available"]',
    );
    if (!availableFields) throw new Error('Missing available fields list');

    const sourceRows = availableFields.querySelectorAll<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"]',
    );
    const category = screen.getByRole('checkbox', { name: 'Category' });
    const amount = screen.getByRole('checkbox', { name: 'Amount' });

    expect(availableFields).toHaveClass('flex-col');
    expect(availableFields).not.toHaveClass('flex-wrap');
    expect(sourceRows).toHaveLength(fields.length);
    sourceRows.forEach((row) => expect(row).toHaveClass('w-full'));
    expect(category).toHaveAttribute('data-pivot-field-id', 'Category');
    expect(category).toHaveAttribute('data-pivot-selected', 'false');
    expect(category).toHaveAttribute('data-pivot-checked', 'false');
    expect(category).toHaveAttribute('aria-checked', 'false');
    expect(amount).toHaveAttribute('data-pivot-field-id', 'Amount');
    expect(amount).toHaveAttribute('data-pivot-checked', 'true');
    expect(amount).toHaveAttribute('aria-checked', 'true');
  });

  it('renders ordered placement wells keyed by placementId with row/value sort controls', () => {
    const { container } = renderList({
      placements: [
        placement({ placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
      ],
    });

    const rowPlacementIds = Array.from(
      zone(container, 'row').querySelectorAll<HTMLElement>('[data-pivot-target="field-chip"]'),
    ).map((node) => node.dataset.pivotPlacementId);

    expect(rowPlacementIds).toEqual(['row:Month:0', 'row:Vendor:1']);
    expect(screen.getByRole('combobox', { name: /Sort Month/i })).toHaveValue('none');
    expect(screen.getByRole('combobox', { name: /Sort values by Amount/i })).toHaveValue('none');
  });

  it('maps row and column sort control changes to the target placement id', () => {
    const { props } = renderList({
      placements: [
        placement({
          placementId: 'column:Category:0',
          fieldId: 'Category',
          area: 'column',
          position: 0,
        }),
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
      ],
    });

    fireEvent.change(screen.getByRole('combobox', { name: /Sort Month/i }), {
      target: { value: 'desc' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Sort Category/i }), {
      target: { value: 'asc' },
    });

    expect(props.onSortOrderChange).toHaveBeenNthCalledWith(1, 'row:Month:0', 'desc');
    expect(props.onSortOrderChange).toHaveBeenNthCalledWith(2, 'column:Category:0', 'asc');
  });

  it('maps value sort control changes to the value placement id', () => {
    const { props } = renderList();

    fireEvent.change(screen.getByRole('combobox', { name: /Sort values by Amount/i }), {
      target: { value: 'desc' },
    });

    expect(props.onValueSortChange).toHaveBeenCalledWith('value:Amount:0', 'desc');
  });

  it('renders every aggregate function supported by the pivot contract', () => {
    renderList();

    const aggregateSelect = screen.getByRole('combobox', {
      name: /Aggregate value field/i,
    }) as HTMLSelectElement;

    expect(Array.from(aggregateSelect.options).map((option) => option.value)).toEqual(
      PIVOT_AGGREGATE_FUNCTION_OPTIONS.map((option) => option.type),
    );
  });

  it('keeps empty-zone placeholder text out of the drag hit target', () => {
    const { container } = renderList({ placements: [] });

    expect(within(zone(container, 'row')).getByText('Drop fields here')).toHaveClass(
      'pointer-events-none',
    );
  });

  it('reorders placements within the same well by placementId', () => {
    const { container, props } = renderList();
    const transfer = dataTransfer();
    const vendor = chip(container, 'row:Vendor:1');
    const month = chip(container, 'row:Month:0');
    setRect(month, { top: 0, height: 20 });

    fireEvent.dragStart(vendor, { dataTransfer: transfer });
    fireEvent.drop(month, { dataTransfer: transfer, clientY: 1 });

    expect(props.onMovePlacement).toHaveBeenCalledWith('row:Vendor:1', 'row', 0);
  });

  it('moves placements across wells without losing placement identity', () => {
    const { container, props } = renderList();
    const transfer = dataTransfer();

    fireEvent.dragStart(chip(container, 'row:Vendor:1'), { dataTransfer: transfer });
    fireEvent.drop(zone(container, 'column'), { dataTransfer: transfer });

    expect(props.onMovePlacement).toHaveBeenCalledWith('row:Vendor:1', 'column', 0);
  });

  it('removes a placement when it is dropped back onto available fields', () => {
    const { container, props } = renderList();
    const transfer = dataTransfer();
    const availableFields = container.querySelector<HTMLElement>(
      '[data-pivot-target="available-fields"]',
    );
    if (!availableFields) throw new Error('Missing available fields');

    fireEvent.dragStart(chip(container, 'row:Vendor:1'), { dataTransfer: transfer });
    fireEvent.dragOver(availableFields, { dataTransfer: transfer });
    fireEvent.drop(availableFields, { dataTransfer: transfer });

    expect(props.onRemovePlacement).toHaveBeenCalledWith('row:Vendor:1');
  });

  it('shows an insertion indicator while hovering over a placement', () => {
    const { container } = renderList();
    const transfer = dataTransfer();
    const vendor = chip(container, 'row:Vendor:1');
    const month = chip(container, 'row:Month:0');
    setRect(month, { top: 0, height: 20 });

    fireEvent.dragStart(vendor, { dataTransfer: transfer });
    const currentMonth = chip(container, 'row:Month:0');
    setRect(currentMonth, { top: 0, height: 20 });
    fireEvent.dragOver(currentMonth, { dataTransfer: transfer, clientY: 1 });

    const indicator = zone(container, 'row').querySelector<HTMLElement>(
      '[data-pivot-target="field-drop-indicator"]',
    );
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute('data-pivot-drop-position', '0');
  });

  it('inserts source fields at the target placement position', () => {
    const { container, props } = renderList();
    const transfer = dataTransfer();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');
    const month = chip(container, 'row:Month:0');
    setRect(month, { top: 0, height: 20 });

    fireEvent.dragStart(category, { dataTransfer: transfer });
    fireEvent.drop(month, { dataTransfer: transfer, clientY: 1 });

    expect(props.onAddField).toHaveBeenCalledWith('Category', 'row', {
      position: 0,
      aggregateFunction: 'count',
    });
  });

  it('does not double-commit when native drag starts after pointer fallback mousedown', () => {
    const { container, props } = renderList();
    const transfer = dataTransfer();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');
    const rowZone = zone(container, 'row');
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: jest.fn(() => [rowZone]),
    });

    try {
      fireEvent.mouseDown(category, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.dragStart(category, { dataTransfer: transfer });
      fireEvent.drop(rowZone, { dataTransfer: transfer });
      fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
      fireEvent.mouseUp(document, { clientX: 20, clientY: 20 });

      expect(props.onAddField).toHaveBeenCalledTimes(1);
      expect(props.onAddField).toHaveBeenCalledWith('Category', 'row', {
        position: 2,
        aggregateFunction: 'count',
      });
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('starts auto-scroll against the provided pane during field drag', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = jest.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelAnimationFrameMock = jest.fn();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrameMock,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelAnimationFrameMock,
    });

    try {
      const scrollContainer = document.createElement('div');
      setRect(scrollContainer, { top: 0, bottom: 100, left: 0, right: 240, height: 100 });
      const getDragScrollContainer = jest.fn(() => scrollContainer);
      const { container } = renderList({
        getDragScrollContainer,
      });
      const transfer = dataTransfer();
      const category = container.querySelector<HTMLElement>(
        '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
      );
      if (!category) throw new Error('Missing Category source chip');
      const fieldList = container.querySelector<HTMLElement>('[data-pivot-target="field-list"]');
      if (!fieldList) throw new Error('Missing field list');

      fireEvent.dragStart(category, { dataTransfer: transfer });
      const accepted = fireEvent.dragOver(fieldList, {
        dataTransfer: transfer,
        clientX: 12,
        clientY: 98,
      });

      expect(accepted).toBe(false);
      expect(transfer.dropEffect).toBe('move');
      expect(requestAnimationFrameMock).toHaveBeenCalled();
      frameCallbacks[0](1);
      expect(getDragScrollContainer).toHaveBeenCalled();

      fireEvent.dragEnd(category);
      expect(cancelAnimationFrameMock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
    }
  });

  it('activates a text source field into the row area on click', () => {
    const { container, props } = renderList();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');

    fireEvent.click(category);

    expect(category).toHaveAttribute('data-pivot-selected', 'true');
    expect(props.onAddField).toHaveBeenCalledWith('Category', 'row', {
      position: 2,
      aggregateFunction: 'count',
    });
  });

  it('does not double-add when a harness-style zone click follows default activation', () => {
    const { container, props } = renderList();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');

    fireEvent.click(category);
    fireEvent.click(zone(container, 'row'));

    expect(props.onAddField).toHaveBeenCalledTimes(1);
    expect(props.onAddField).toHaveBeenCalledWith('Category', 'row', {
      position: 2,
      aggregateFunction: 'count',
    });
  });

  it('moves an auto-activated source field when a follow-up click targets another well', () => {
    const { container, props, rerender } = renderList();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');

    fireEvent.click(category);
    rerender(
      <PivotFieldList
        {...props}
        placements={[
          ...props.placements,
          placement({
            placementId: 'row:Category:2',
            fieldId: 'Category',
            area: 'row',
            position: 2,
          }),
        ]}
      />,
    );
    fireEvent.click(zone(container, 'column'));

    expect(props.onAddField).toHaveBeenCalledTimes(1);
    expect(props.onMovePlacement).toHaveBeenCalledWith('row:Category:2', 'column', 0);
  });

  it('does not double-add when a same-well chip click follows default activation', () => {
    const { container, props, rerender } = renderList({
      placements: [
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
      ],
    });
    const amount = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Amount"]',
    );
    if (!amount) throw new Error('Missing Amount source chip');

    fireEvent.click(amount);
    rerender(
      <PivotFieldList
        {...props}
        placements={[
          ...props.placements,
          placement({
            placementId: 'value:Amount:0',
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
          }),
        ]}
      />,
    );
    fireEvent.click(chip(container, 'value:Amount:0'));

    expect(props.onAddField).toHaveBeenCalledTimes(1);
  });

  it('activates a numeric source field into the value area from the keyboard', () => {
    const { container, props } = renderList({
      placements: [
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
      ],
    });
    const amount = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Amount"]',
    );
    if (!amount) throw new Error('Missing Amount source chip');

    fireEvent.keyDown(amount, { key: 'Enter' });

    expect(props.onAddField).toHaveBeenCalledWith('Amount', 'value', {
      position: 0,
      aggregateFunction: 'sum',
    });
  });

  it('keeps duplicate source-field placements independently addressable', () => {
    const { container, props } = renderList({
      placements: [
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
          displayName: 'Amount Sum',
        }),
        placement({
          placementId: 'value:Amount:1',
          fieldId: 'Amount',
          area: 'value',
          position: 1,
          aggregateFunction: 'max',
          displayName: 'Amount Max',
        }),
      ],
    });

    const amountChips = zone(container, 'value').querySelectorAll(
      '[data-pivot-target="field-chip"][data-pivot-field-id="Amount"]',
    );
    expect(amountChips).toHaveLength(2);

    fireEvent.click(
      within(chip(container, 'value:Amount:1')).getByRole('button', { name: /Remove Amount Max/i }),
    );
    expect(props.onRemovePlacement).toHaveBeenCalledWith('value:Amount:1');
  });

  it('keeps remove button pointer input out of drag fallback handling', () => {
    const { container, props } = renderList();
    const removeButton = within(chip(container, 'row:Vendor:1')).getByRole('button', {
      name: /Remove Vendor/i,
    });
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsFromPoint = jest.fn(() => [chip(container, 'row:Vendor:1')]);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    try {
      fireEvent.mouseDown(removeButton, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(document, { clientX: 30, clientY: 30 });
      fireEvent.mouseUp(document, { clientX: 30, clientY: 30 });
      fireEvent.click(removeButton);

      expect(elementsFromPoint).not.toHaveBeenCalled();
      expect(props.onMovePlacement).not.toHaveBeenCalled();
      expect(props.onRemovePlacement).toHaveBeenCalledWith('row:Vendor:1');
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('renders per-capability read-only controls as disabled', () => {
    renderList({
      canAddFields: false,
      canReorderFields: false,
      canRemoveFields: false,
      canChangeAggregate: false,
      canSortLabels: false,
      canSortByValue: false,
    });

    expect(screen.getByRole('combobox', { name: /Sort Month/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /Sort values by Amount/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /Aggregate value field/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Remove Month/i })).not.toBeInTheDocument();
  });

  it('keeps long value-field chips structurally constrained to the pane', () => {
    const longName =
      'Extremely Long Revenue Amount Field Name That Should Not Push Past The Pivot Pane';
    const { container } = renderList({
      fields: [
        ...fields,
        { id: 'LongAmount', name: longName, sourceColumn: 4, dataType: 'number' },
      ],
      placements: [
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
        placement({
          placementId: 'value:LongAmount:0',
          fieldId: 'LongAmount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
          displayName: longName,
        }),
      ],
    });

    const valueChip = chip(container, 'value:LongAmount:0');
    const label = valueChip.querySelector('span.truncate');
    const controls = valueChip.querySelector('[data-pivot-target="placement-controls"]');

    expect(valueChip).toHaveClass('w-full', 'max-w-full', 'min-w-0');
    expect(valueChip).toHaveAttribute('title', longName);
    expect(valueChip).toHaveAttribute('aria-label', longName);
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(label).toHaveAttribute('title', longName);
    expect(label).toHaveAttribute('aria-label', longName);
    expect(controls).toHaveClass('flex', 'w-full', 'min-w-0');
    expect(screen.getByRole('combobox', { name: /Sort values by/i })).toHaveClass('min-w-0');
  });
});
