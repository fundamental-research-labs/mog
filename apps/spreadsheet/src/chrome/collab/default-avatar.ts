/**
 * Generates a default avatar as an SVG data URI for users without a custom avatar.
 * Produces a gradient circle with the user's initial — looks like a real avatar image.
 */

function adjustColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(clean.substring(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(clean.substring(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(clean.substring(4, 6), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function generateDefaultAvatarUrl(name: string, color: string): string {
  const initial = (name.charAt(0) || '?').toUpperCase();
  const lighter = adjustColor(color, 30);
  const darker = adjustColor(color, -40);

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0%" stop-color="${lighter}"/>`,
    `<stop offset="100%" stop-color="${darker}"/>`,
    '</linearGradient></defs>',
    '<circle cx="16" cy="16" r="16" fill="url(#bg)"/>',
    '<circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>',
    `<text x="16" y="16" text-anchor="middle" dy="0.36em" fill="white" font-size="14" font-family="Inter,-apple-system,BlinkMacSystemFont,sans-serif" font-weight="600">${initial}</text>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
