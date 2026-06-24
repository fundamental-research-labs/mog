import {
  type MogVersionMetadataExportSink,
  type MogVersionMetadataExportSinkAuthorization,
} from '../version/xlsx-metadata/version-xlsx-metadata-export-gate';

export function blockedMetadataSink(
  writes: { count: number } = { count: 0 },
): MogVersionMetadataExportSink {
  return {
    write: () => {
      writes.count += 1;
      throw new Error('metadata export sink must not be called before authorization');
    },
  };
}

export function recordingMetadataSink(
  captured: {
    writes: number;
    authorization?: MogVersionMetadataExportSinkAuthorization;
  },
  result: Uint8Array,
): MogVersionMetadataExportSink {
  return {
    write: (_xlsxBytes, authorization) => {
      captured.writes += 1;
      captured.authorization = authorization;
      return result;
    },
  };
}
