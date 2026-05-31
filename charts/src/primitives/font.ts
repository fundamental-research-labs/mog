const GENERIC_FONT_FAMILIES = new Set([
  'caption',
  'cursive',
  'emoji',
  'fangsong',
  'fantasy',
  'icon',
  'math',
  'menu',
  'message-box',
  'monospace',
  'sans-serif',
  'serif',
  'small-caption',
  'status-bar',
  'system-ui',
  'ui-monospace',
  'ui-rounded',
  'ui-sans-serif',
  'ui-serif',
]);

const THEME_FONT_FAMILIES = new Map<string, string>([
  ['+mn-lt', 'Calibri, Arial, sans-serif'],
  ['+mn-ea', 'Calibri, Arial, sans-serif'],
  ['+mn-cs', 'Calibri, Arial, sans-serif'],
  ['+mj-lt', 'Calibri, Arial, sans-serif'],
  ['+mj-ea', 'Calibri, Arial, sans-serif'],
  ['+mj-cs', 'Calibri, Arial, sans-serif'],
]);

function isQuoted(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  );
}

function quoteFontFamily(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isBareCssIdentifier(value: string): boolean {
  return /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(value);
}

function normalizeFontFamilyToken(value: string): string {
  const token = value.trim();
  if (!token) return '';
  const themeFont = THEME_FONT_FAMILIES.get(token.toLowerCase());
  if (themeFont) return themeFont;
  if (isQuoted(token) || GENERIC_FONT_FAMILIES.has(token.toLowerCase())) return token;
  return isBareCssIdentifier(token) ? token : quoteFontFamily(token);
}

export function canvasFontFamily(fontFamily: string): string {
  const normalized = fontFamily
    .split(',')
    .map(normalizeFontFamilyToken)
    .filter(Boolean)
    .join(', ');
  return normalized || 'sans-serif';
}

export function buildCanvasFontString(
  fontWeight: string | number | undefined,
  fontSize: number,
  fontFamily: string,
  fontStyle: string | undefined = undefined,
): string {
  const style = fontStyle && fontStyle !== 'normal' ? `${fontStyle} ` : '';
  const weight = fontWeight && fontWeight !== 'normal' ? `${fontWeight} ` : '';
  return `${style}${weight}${fontSize}px ${canvasFontFamily(fontFamily)}`;
}
