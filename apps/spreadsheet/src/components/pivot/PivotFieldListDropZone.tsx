import { Fragment, type DragEvent, type ReactNode } from 'react';

import type {
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
} from '@mog-sdk/contracts/pivot';
import { DropInsertionIndicator } from './PivotFieldListControls';
import { placementId, type DropIndicator } from './PivotFieldListDrag';

export interface PlacedField {
  field: PivotField;
  placement: PivotFieldPlacement;
}

export interface PivotFieldDropZoneProps {
  area: PivotFieldArea;
  label: string;
  placedFields: PlacedField[];
  dragOverArea: PivotFieldArea | null;
  dropIndicator: DropIndicator | null;
  acceptsSelected: boolean;
  renderPlacementChip: (item: PlacedField, index: number) => ReactNode;
  onDragOver: (event: DragEvent<HTMLDivElement>, area: PivotFieldArea) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>, area: PivotFieldArea) => void;
  onClick: (area: PivotFieldArea) => void;
}

export function PivotFieldDropZone({
  area,
  label,
  placedFields,
  dragOverArea,
  dropIndicator,
  acceptsSelected,
  renderPlacementChip,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: PivotFieldDropZoneProps) {
  const dropAreaClass = `flex flex-col gap-1.5 min-h-9 p-1.5 bg-ss-surface border border-dashed rounded transition-colors ${
    dragOverArea === area ? 'bg-ss-primary-light border-ss-primary' : 'border-ss-border'
  }`;

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5"
      data-pivot-target="field-zone-wrapper"
      data-pivot-zone={area}
    >
      <div className="text-caption font-medium text-ss-text-secondary">{label}</div>
      <div
        className={dropAreaClass}
        onDragOver={(event) => onDragOver(event, area)}
        onDragLeave={onDragLeave}
        onDrop={(event) => onDrop(event, area)}
        onClick={() => onClick(area)}
        data-pivot-target="field-zone"
        data-pivot-zone={area}
        data-pivot-accepts-selected={acceptsSelected ? 'true' : 'false'}
      >
        {placedFields.length === 0 ? (
          <span className="pointer-events-none text-caption text-ss-text-disabled italic p-1">
            Drop fields here
          </span>
        ) : (
          <>
            {dropIndicator?.area === area && dropIndicator.position === 0 && (
              <DropInsertionIndicator area={area} position={0} />
            )}
            {placedFields.map((item, index) => (
              <Fragment key={placementId(item.placement)}>
                {renderPlacementChip(item, index)}
                {dropIndicator?.area === area && dropIndicator.position === index + 1 && (
                  <DropInsertionIndicator area={area} position={index + 1} />
                )}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
