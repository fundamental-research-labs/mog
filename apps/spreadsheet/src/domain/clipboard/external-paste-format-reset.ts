const PLAIN_NUMBER_TEXT_RE = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const DATE_TEXT_RE =
  /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;
const MONTH_DATE_TEXT_RE =
  /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.? \d{1,2}(?:,? \d{2,4})?|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?(?: \d{2,4})?)$/i;
const TIME_TEXT_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?$/i;
const SIMPLE_FRACTION_TEXT_RE = /^[+-]?(?:\d+\s+)?\d+\/\d+$/;
const EXCEL_ERROR_TEXT_RE =
  /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)$/i;
const CURRENCY_SYMBOL_RE = /[\u0024\u20ac\u00a3\u00a5\u20b9]/;

export function shouldResetNumberFormatBeforeExternalPaste(value: unknown): boolean {
  if (value === null || value === undefined || isCellErrorObject(value)) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return false;
  if (typeof value !== 'string') return true;

  const text = value.trim();
  if (text === '' || text.startsWith("'")) return false;
  if (text.startsWith('=')) return true;
  if (/^(?:true|false)$/i.test(text) || EXCEL_ERROR_TEXT_RE.test(text)) return false;

  return (
    PLAIN_NUMBER_TEXT_RE.test(text) ||
    isFormattedNumberText(text) ||
    DATE_TEXT_RE.test(text) ||
    MONTH_DATE_TEXT_RE.test(text) ||
    TIME_TEXT_RE.test(text) ||
    SIMPLE_FRACTION_TEXT_RE.test(text)
  );
}

function isCellErrorObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function isFormattedNumberText(text: string): boolean {
  let normalized = text.trim();
  let sawFormatMarker = false;

  if (/^\(.*\)$/.test(normalized)) {
    normalized = normalized.slice(1, -1).trim();
    sawFormatMarker = true;
  }

  if (/^[+-]/.test(normalized)) {
    normalized = normalized.slice(1).trim();
  }

  if (CURRENCY_SYMBOL_RE.test(normalized)) {
    normalized = normalized.replace(CURRENCY_SYMBOL_RE, '').trim();
    sawFormatMarker = true;
  }

  if (normalized.endsWith('%')) {
    normalized = normalized.slice(0, -1).trim();
    sawFormatMarker = true;
  }

  if (normalized.includes(',')) {
    normalized = normalized.replace(/,/g, '');
    sawFormatMarker = true;
  }

  return sawFormatMarker && PLAIN_NUMBER_TEXT_RE.test(normalized);
}
