import type { FormControlOoxmlProps } from '../../bridges/compute/compute-types.gen';

type ImportedNumericSource = {
  ooxml?: FormControlOoxmlProps;
};

function numericOoxmlValue(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function numericControlBounds(object: ImportedNumericSource): {
  min: number;
  max: number;
  step: number;
  page?: number;
} {
  const min = numericOoxmlValue(object.ooxml?.min, 0);
  const max = Math.max(min, numericOoxmlValue(object.ooxml?.max, 100));
  const step = Math.max(1, numericOoxmlValue(object.ooxml?.inc, 1));
  const rawPage = object.ooxml?.page;
  return {
    min,
    max,
    step,
    ...(typeof rawPage === 'number' && Number.isFinite(rawPage)
      ? { page: Math.max(step, rawPage) }
      : {}),
  };
}

export function importedControlEnabled(object: ImportedNumericSource): boolean {
  return object.ooxml?.controlPr?.disabled !== true;
}

export function importedControlOrientation(
  object: ImportedNumericSource,
): 'horizontal' | 'vertical' {
  return object.ooxml?.horiz === false ? 'vertical' : 'horizontal';
}
