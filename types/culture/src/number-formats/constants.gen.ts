// Auto-generated from Rust compute-formats constants.
// Do not edit manually. Regenerate with:
//   cargo test -p bridge-ts --test generate_format_constants -- generate --nocapture
//
// Source: compute-core/crates/compute-formats/src/constants.rs

export type NumberFormatType =
  | 'general'
  | 'number'
  | 'currency'
  | 'accounting'
  | 'date'
  | 'time'
  | 'percentage'
  | 'fraction'
  | 'scientific'
  | 'text'
  | 'special'
  | 'custom';

export interface FormatPreset {
  code: string;
  example: string;
  description?: string;
}

export interface FormatCategory {
  type: NumberFormatType;
  label: string;
  description?: string;
}

export const FORMAT_CATEGORIES: FormatCategory[] = [
  { type: 'general', label: 'General', description: 'No specific format' },
  { type: 'number', label: 'Number', description: 'Decimal numbers with optional thousands separator' },
  { type: 'currency', label: 'Currency', description: 'Currency values with symbol' },
  { type: 'accounting', label: 'Accounting', description: 'Currency with aligned symbols and parentheses for negatives' },
  { type: 'date', label: 'Date', description: 'Date values' },
  { type: 'time', label: 'Time', description: 'Time values' },
  { type: 'percentage', label: 'Percentage', description: 'Percentage values' },
  { type: 'fraction', label: 'Fraction', description: 'Fractional values' },
  { type: 'scientific', label: 'Scientific', description: 'Scientific notation' },
  { type: 'text', label: 'Text', description: 'Treat as text' },
  { type: 'special', label: 'Special', description: 'Special formats (Zip, Phone, SSN)' },
  { type: 'custom', label: 'Custom', description: 'Custom format string' }
];

export const GENERAL_FORMATS: Record<string, FormatPreset> = {
  default: {
    code: 'General',
    description: '',
    example: '1234.5'
  }
};

export const NUMBER_FORMATS: Record<string, FormatPreset> = {
  integer: {
    code: '0',
    description: 'No decimal places',
    example: '1235'
  },
  decimal1: {
    code: '0.0',
    description: '1 decimal place',
    example: '1234.5'
  },
  decimal2: {
    code: '0.00',
    description: '2 decimal places',
    example: '1234.50'
  },
  decimal3: {
    code: '0.000',
    description: '3 decimal places',
    example: '1234.500'
  },
  thousands: {
    code: '#,##0',
    description: 'Thousands separator, no decimals',
    example: '1,235'
  },
  thousandsDecimal1: {
    code: '#,##0.0',
    description: 'Thousands separator, 1 decimal',
    example: '1,234.5'
  },
  thousandsDecimal2: {
    code: '#,##0.00',
    description: 'Thousands separator, 2 decimals',
    example: '1,234.50'
  },
  negativeRed: {
    code: '#,##0.00;[Red]-#,##0.00',
    description: 'Red negative numbers',
    example: '-1,234.50'
  },
  negativeParens: {
    code: '#,##0.00;(#,##0.00)',
    description: 'Parentheses for negatives',
    example: '(1,234.50)'
  },
  negativeParensRed: {
    code: '#,##0.00;[Red](#,##0.00)',
    description: 'Red parentheses for negatives',
    example: '(1,234.50)'
  }
};

export const CURRENCY_FORMATS: Record<string, FormatPreset> = {
  usd: {
    code: '$#,##0.00',
    description: 'US Dollar',
    example: '$1,234.50'
  },
  usdNegMinus: {
    code: '$#,##0.00;-$#,##0.00',
    description: 'USD minus',
    example: '-$1,234.50'
  },
  usdNegParens: {
    code: '$#,##0.00;($#,##0.00)',
    description: 'USD parentheses',
    example: '($1,234.50)'
  },
  usdNegRed: {
    code: '$#,##0.00;[Red]-$#,##0.00',
    description: 'USD red minus',
    example: '-$1,234.50'
  },
  usdNegParensRed: {
    code: '$#,##0.00;[Red]($#,##0.00)',
    description: 'USD red parentheses',
    example: '($1,234.50)'
  },
  eur: {
    code: '€#,##0.00',
    description: 'Euro',
    example: '€1,234.50'
  },
  gbp: {
    code: '£#,##0.00',
    description: 'British Pound',
    example: '£1,234.50'
  },
  jpy: {
    code: '¥#,##0',
    description: 'Japanese Yen (no decimals)',
    example: '¥1,235'
  },
  cny: {
    code: '¥#,##0.00',
    description: 'Chinese Yuan',
    example: '¥1,234.50'
  },
  inr: {
    code: '₹#,##0.00',
    description: 'Indian Rupee',
    example: '₹1,234.50'
  },
  krw: {
    code: '₩#,##0',
    description: 'Korean Won (no decimals)',
    example: '₩1,235'
  },
  chf: {
    code: 'CHF #,##0.00',
    description: 'Swiss Franc',
    example: 'CHF 1,234.50'
  },
  cad: {
    code: 'CA$#,##0.00',
    description: 'Canadian Dollar',
    example: 'CA$1,234.50'
  },
  aud: {
    code: 'A$#,##0.00',
    description: 'Australian Dollar',
    example: 'A$1,234.50'
  }
};

export const ACCOUNTING_FORMATS: Record<string, FormatPreset> = {
  usd: {
    code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
    description: 'USD Accounting',
    example: '$ 1,234.50'
  },
  eur: {
    code: '_(€* #,##0.00_);_(€* (#,##0.00);_(€* "-"??_);_(@_)',
    description: 'EUR Accounting',
    example: '€ 1,234.50'
  },
  gbp: {
    code: '_(£* #,##0.00_);_(£* (#,##0.00);_(£* "-"??_);_(@_)',
    description: 'GBP Accounting',
    example: '£ 1,234.50'
  }
};

export const DATE_FORMATS: Record<string, FormatPreset> = {
  shortUS: {
    code: 'm/d/yyyy',
    description: 'Short date (US)',
    example: '12/13/2025'
  },
  mediumUS: {
    code: 'mmm d, yyyy',
    description: 'Medium date (US)',
    example: 'Dec 13, 2025'
  },
  longUS: {
    code: 'mmmm d, yyyy',
    description: 'Long date (US)',
    example: 'December 13, 2025'
  },
  fullUS: {
    code: 'dddd, mmmm d, yyyy',
    description: 'Full date (US)',
    example: 'Saturday, December 13, 2025'
  },
  iso: {
    code: 'yyyy-mm-dd',
    description: 'ISO 8601',
    example: '2025-12-13'
  },
  shortEU: {
    code: 'd/m/yyyy',
    description: 'Short date (EU)',
    example: '13/12/2025'
  },
  mediumEU: {
    code: 'd mmm yyyy',
    description: 'Medium date (EU)',
    example: '13 Dec 2025'
  },
  longEU: {
    code: 'd mmmm yyyy',
    description: 'Long date (EU)',
    example: '13 December 2025'
  },
  monthYear: {
    code: 'mmmm yyyy',
    description: 'Month and year',
    example: 'December 2025'
  },
  monthYearShort: {
    code: 'mmm yyyy',
    description: 'Short month and year',
    example: 'Dec 2025'
  },
  dayMonth: {
    code: 'd mmmm',
    description: 'Day and month',
    example: '13 December'
  },
  dayMonthShort: {
    code: 'd mmm',
    description: 'Short day and month',
    example: '13 Dec'
  },
  excelShort: {
    code: 'm/d/yy',
    description: 'Short spreadsheet date',
    example: '12/13/25'
  },
  excelMedium: {
    code: 'd-mmm-yy',
    description: 'Medium spreadsheet date',
    example: '13-Dec-25'
  },
  excelLong: {
    code: 'd-mmm-yyyy',
    description: 'Long spreadsheet date',
    example: '13-Dec-2025'
  }
};

export const TIME_FORMATS: Record<string, FormatPreset> = {
  short12: {
    code: 'h:mm AM/PM',
    description: '12-hour short',
    example: '3:45 PM'
  },
  long12: {
    code: 'h:mm:ss AM/PM',
    description: '12-hour with seconds',
    example: '3:45:30 PM'
  },
  short24: {
    code: 'HH:mm',
    description: '24-hour short',
    example: '15:45'
  },
  long24: {
    code: 'HH:mm:ss',
    description: '24-hour with seconds',
    example: '15:45:30'
  },
  dateTime12: {
    code: 'm/d/yyyy h:mm AM/PM',
    description: 'Date and 12-hour time',
    example: '12/13/2025 3:45 PM'
  },
  dateTime24: {
    code: 'yyyy-mm-dd HH:mm',
    description: 'ISO date and 24-hour time',
    example: '2025-12-13 15:45'
  },
  durationHM: {
    code: '[h]:mm',
    description: 'Hours and minutes (elapsed)',
    example: '25:30'
  },
  durationHMS: {
    code: '[h]:mm:ss',
    description: 'Hours, minutes, seconds (elapsed)',
    example: '25:30:45'
  },
  durationMS: {
    code: '[mm]:ss',
    description: 'Minutes and seconds (elapsed)',
    example: '1530:45'
  }
};

export const PERCENTAGE_FORMATS: Record<string, FormatPreset> = {
  integer: {
    code: '0%',
    description: 'No decimal places',
    example: '50%'
  },
  decimal1: {
    code: '0.0%',
    description: '1 decimal place',
    example: '50.0%'
  },
  decimal2: {
    code: '0.00%',
    description: '2 decimal places',
    example: '50.00%'
  },
  decimal3: {
    code: '0.000%',
    description: '3 decimal places',
    example: '50.000%'
  }
};

export const FRACTION_FORMATS: Record<string, FormatPreset> = {
  halves: {
    code: '# ?/2',
    description: 'Halves (1/2)',
    example: '1 1/2'
  },
  quarters: {
    code: '# ?/4',
    description: 'Quarters (1/4)',
    example: '1 1/4'
  },
  eighths: {
    code: '# ?/8',
    description: 'Eighths (1/8)',
    example: '1 3/8'
  },
  sixteenths: {
    code: '# ??/16',
    description: 'Sixteenths (1/16)',
    example: '1 5/16'
  },
  tenths: {
    code: '# ?/10',
    description: 'Tenths (1/10)',
    example: '1 3/10'
  },
  hundredths: {
    code: '# ??/100',
    description: 'Hundredths (1/100)',
    example: '1 25/100'
  },
  upToOneDigit: {
    code: '# ?/?',
    description: 'Up to one digit (1/4)',
    example: '1 2/3'
  },
  upToTwoDigits: {
    code: '# ??/??',
    description: 'Up to two digits (21/25)',
    example: '1 25/67'
  },
  upToThreeDigits: {
    code: '# ???/???',
    description: 'Up to three digits (312/943)',
    example: '1 312/943'
  }
};

export const SCIENTIFIC_FORMATS: Record<string, FormatPreset> = {
  default: {
    code: '0.00E+00',
    description: '2 decimal places',
    example: '1.23E+03'
  },
  decimal1: {
    code: '0.0E+00',
    description: '1 decimal place',
    example: '1.2E+03'
  },
  decimal3: {
    code: '0.000E+00',
    description: '3 decimal places',
    example: '1.235E+03'
  },
  noDecimals: {
    code: '0E+00',
    description: 'No decimal places',
    example: '1E+03'
  }
};

export const TEXT_FORMATS: Record<string, FormatPreset> = {
  default: {
    code: '@',
    description: 'Display as entered',
    example: '1234'
  }
};

export const SPECIAL_FORMATS: Record<string, FormatPreset> = {
  zipCode: {
    code: '00000',
    description: 'ZIP Code (5-digit)',
    example: '01234'
  },
  zipPlus4: {
    code: '00000-0000',
    description: 'ZIP+4 Code',
    example: '01234-5678'
  },
  phone: {
    code: '(###) ###-####',
    description: 'Phone Number',
    example: '(555) 123-4567'
  },
  ssn: {
    code: '000-00-0000',
    description: 'Social Security Number',
    example: '123-45-6789'
  }
};

export const FORMAT_PRESETS: Record<NumberFormatType, Record<string, FormatPreset>> = {
  general: GENERAL_FORMATS,
  number: NUMBER_FORMATS,
  currency: CURRENCY_FORMATS,
  accounting: ACCOUNTING_FORMATS,
  date: DATE_FORMATS,
  time: TIME_FORMATS,
  percentage: PERCENTAGE_FORMATS,
  fraction: FRACTION_FORMATS,
  scientific: SCIENTIFIC_FORMATS,
  text: TEXT_FORMATS,
  special: SPECIAL_FORMATS,
  custom: {}
};

export const DEFAULT_FORMAT_BY_TYPE: Record<NumberFormatType, string> = {
  accounting: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
  currency: '$#,##0.00',
  custom: 'General',
  date: 'm/d/yyyy',
  fraction: '# ?/?',
  general: 'General',
  number: '#,##0.00',
  percentage: '0.00%',
  scientific: '0.00E+00',
  special: '00000',
  text: '@',
  time: 'h:mm AM/PM',
};

export const CURRENCY_SYMBOLS = [
  {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$'
  },
  {
    code: 'EUR',
    name: 'Euro',
    symbol: '€'
  },
  {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£'
  },
  {
    code: 'JPY',
    name: 'Japanese Yen',
    symbol: '¥'
  },
  {
    code: 'CNY',
    name: 'Chinese Yuan',
    symbol: '¥'
  },
  {
    code: 'INR',
    name: 'Indian Rupee',
    symbol: '₹'
  },
  {
    code: 'KRW',
    name: 'Korean Won',
    symbol: '₩'
  },
  {
    code: 'CHF',
    name: 'Swiss Franc',
    symbol: 'CHF'
  },
  {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'CA$'
  },
  {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: 'A$'
  },
  {
    code: 'BRL',
    name: 'Brazilian Real',
    symbol: 'R$'
  },
  {
    code: 'RUB',
    name: 'Russian Ruble',
    symbol: '₽'
  },
  {
    code: 'SEK',
    name: 'Swedish Krona',
    symbol: 'kr'
  },
  {
    code: 'NOK',
    name: 'Norwegian Krone',
    symbol: 'kr'
  },
  {
    code: 'DKK',
    name: 'Danish Krone',
    symbol: 'kr'
  },
  {
    code: 'PLN',
    name: 'Polish Zloty',
    symbol: 'zł'
  },
  {
    code: 'TRY',
    name: 'Turkish Lira',
    symbol: '₺'
  },
  {
    code: 'THB',
    name: 'Thai Baht',
    symbol: '฿'
  },
  {
    code: 'SGD',
    name: 'Singapore Dollar',
    symbol: 'S$'
  },
  {
    code: 'HKD',
    name: 'Hong Kong Dollar',
    symbol: 'HK$'
  },
  {
    code: 'TWD',
    name: 'Taiwan Dollar',
    symbol: 'NT$'
  },
  {
    code: 'PHP',
    name: 'Philippine Peso',
    symbol: '₱'
  },
  {
    code: 'ZAR',
    name: 'South African Rand',
    symbol: 'R'
  },
  {
    code: 'MXN',
    name: 'Mexican Peso',
    symbol: 'Mex$'
  },
  {
    code: 'AED',
    name: 'UAE Dirham',
    symbol: 'AED'
  },
  {
    code: 'SAR',
    name: 'Saudi Riyal',
    symbol: 'SAR'
  }
];

export const NEGATIVE_FORMATS = [
  {
    format: '-#,##0.00',
    id: 'minus',
    label: '-1,234.10'
  },
  {
    color: 'red',
    format: '[Red]-#,##0.00',
    id: 'minusRed',
    label: '-1,234.10'
  },
  {
    format: '(#,##0.00)',
    id: 'parentheses',
    label: '(1,234.10)'
  },
  {
    color: 'red',
    format: '[Red](#,##0.00)',
    id: 'parenthesesRed',
    label: '(1,234.10)'
  }
];

export const EXCEL_BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};
