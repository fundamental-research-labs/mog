import type { MogWorkbookVersionXlsxMetadata } from './xlsx-version-metadata-schema';

export function parseMogVersionMetadataJsonPayload(xml: string): unknown {
  return JSON.parse(unescapeXml(metadataJsonPayload(xml)));
}

export function versionMetadataXml(metadata: MogWorkbookVersionXlsxMetadata): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<mogVersionMetadata xmlns="https://schemas.mog.dev/workbook/version-metadata/1">',
    `<json>${escapeXml(JSON.stringify(metadata))}</json>`,
    '</mogVersionMetadata>',
  ].join('');
}

function metadataJsonPayload(xml: string): string {
  const match = /<json>([\s\S]*)<\/json>/.exec(xml);
  const json = match?.[1];
  if (!json) throw new Error('missing Mog version metadata JSON payload');
  return json;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
