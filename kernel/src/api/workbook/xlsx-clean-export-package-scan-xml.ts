export function extractXmlTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>`, 'g'))].map(
    (match) => match[0] ?? '',
  );
}

export function xmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXmlAttributeValue(value);
}

function decodeXmlAttributeValue(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|amp|lt|gt|quot|apos);/g,
    (match, hex, dec) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      switch (match) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        default:
          return match;
      }
    },
  );
}
