import { jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type {
  PivotField,
  PivotFieldPlacementFlat,
  PivotTableConfig,
} from '@mog-sdk/contracts/pivot';

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

  it('places a selected source field after a clicked placement chip', () => {
    const { container, props } = renderList();
    const category = container.querySelector<HTMLElement>(
      '[data-pivot-target="field-chip"][data-pivot-area="available"][data-pivot-field-id="Category"]',
    );
    if (!category) throw new Error('Missing Category source chip');

    fireEvent.click(category);
    expect(category).toHaveAttribute('data-pivot-selected', 'true');

    fireEvent.click(chip(container, 'row:Month:0'));

    expect(props.onAddField).toHaveBeenCalledWith('Category', 'row', {
      position: 1,
      aggregateFunction: 'count',
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
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(controls).toHaveClass('w-full', 'min-w-0');
    expect(screen.getByRole('combobox', { name: /Sort values by/i })).toHaveClass('min-w-0');
  });
});
