import type { CellFormat } from '@mog-sdk/contracts/core';

export function solidFillFormat(
  color: string,
): Pick<CellFormat, 'backgroundColor' | 'patternType'> {
  return {
    backgroundColor: color,
    patternType: 'solid',
  };
}

export function normalizeSolidFillFormat<T extends Partial<CellFormat>>(format: T): T {
  if (!format.backgroundColor || format.gradientFill || format.patternType) {
    return format;
  }

  return {
    ...format,
    patternType: 'solid',
  };
}
