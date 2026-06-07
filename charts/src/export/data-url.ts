export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    result += alphabet[(triple >> 18) & 63];
    result += alphabet[(triple >> 12) & 63];
    result += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }

  return result;
}

export function utf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

export function bytesToDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
