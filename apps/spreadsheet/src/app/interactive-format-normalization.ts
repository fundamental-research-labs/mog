import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';

export const GENERAL_NUMBER_FORMAT = 'General';

export type InteractiveCommitCellData = {
  hasFormula?: boolean | null;
  formula?: unknown;
  format?: unknown;
};

export function shouldNormalizeEnteredZeroFormat(
  input: string,
  previousCell: InteractiveCommitCellData | null | undefined,
): boolean {
  if (!isPlainZeroInput(input) || !cellContainsFormula(previousCell)) {
    return false;
  }

  const formatCode =
    previousCell?.format &&
    typeof previousCell.format === 'object' &&
    'numberFormat' in previousCell.format
      ? previousCell.format.numberFormat
      : undefined;
  if (typeof formatCode !== 'string' || detectFormatType(formatCode) !== 'accounting') {
    return false;
  }

  return zeroSectionOmitsMandatoryDigits(formatCode);
}

function cellContainsFormula(cell: InteractiveCommitCellData | null | undefined): boolean {
  return cell?.hasFormula === true || (typeof cell?.formula === 'string' && cell.formula !== '');
}

function isPlainZeroInput(input: string): boolean {
  return /^[+-]?(?:0+(?:\.0*)?|\.0+)$/.test(input.trim());
}

function zeroSectionOmitsMandatoryDigits(formatCode: string): boolean {
  const sections = splitFormatSections(formatCode);
  if (sections.length < 3) {
    return false;
  }

  return !/[0#]/.test(removeLiteralControls(sections[2]));
}

function splitFormatSections(formatCode: string): string[] {
  const sections: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < formatCode.length; i += 1) {
    const char = formatCode[i];

    if (char === '\\') {
      current += char;
      if (i + 1 < formatCode.length) {
        current += formatCode[i + 1];
        i += 1;
      }
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }

    if (char === ';' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  sections.push(current);
  return sections;
}

function removeLiteralControls(section: string): string {
  let cleaned = '';
  let quoted = false;

  for (let i = 0; i < section.length; i += 1) {
    const char = section[i];

    if (quoted) {
      if (char === '"') {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === '\\' || char === '_' || char === '*') {
      i += 1;
      continue;
    }

    if (char === '[') {
      const end = section.indexOf(']', i + 1);
      if (end !== -1) {
        i = end;
        continue;
      }
    }

    cleaned += char;
  }

  return cleaned;
}
