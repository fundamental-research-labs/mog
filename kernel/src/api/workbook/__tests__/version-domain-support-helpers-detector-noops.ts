import type { Workbook } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import { VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID } from './version-domain-support-helpers-constants';

const VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_GETTER = Symbol(
  'mog.versionDomainDetectorNoopSyntheticGetAllSheetIds',
);

type VersionDomainDetectorNoopGetAllSheetIds = (() => Promise<unknown>) & {
  [VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_GETTER]?: true;
};

type VersionDomainDetectorNoopInstallOptions = {
  readonly allowSyntheticSheetIdFallback?: boolean;
};

export function installVersionDomainDetectorNoopsOnHandles(...handles: readonly unknown[]): void {
  for (const handle of handles) {
    installVersionDomainDetectorNoopsOnBridge(
      ((handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined)
        ?.computeBridge,
    );
  }
}

export function installVersionDomainDetectorNoopsOnWorkbook(wb: Pick<Workbook, 'version'>): void {
  const version = wb.version as unknown as {
    ctx?: DocumentContext;
    versionContext?: DocumentContext;
  };
  installVersionDomainDetectorNoopsOnBridge((version.ctx ?? version.versionContext)?.computeBridge);
}

export function installVersionDomainDetectorNoopsOnBridgeMock(bridge: unknown): void {
  installVersionDomainDetectorNoopsOnBridge(bridge, { allowSyntheticSheetIdFallback: true });
}

function installVersionDomainDetectorNoopsOnBridge(
  bridge: unknown,
  options: VersionDomainDetectorNoopInstallOptions = {},
): void {
  if (!isMutableRecord(bridge)) return;
  const getAllSheetIds = bindNativeGetAllSheetIds(bridge);
  if (getAllSheetIds) {
    bridge.getAllSheetIds = async () => {
      const sheetIds = await getAllSheetIds();
      return Array.isArray(sheetIds) ? sheetIds : [];
    };
  } else if (options.allowSyntheticSheetIdFallback) {
    const syntheticGetAllSheetIds: VersionDomainDetectorNoopGetAllSheetIds = async () => [
      VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID,
    ];
    syntheticGetAllSheetIds[VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_GETTER] = true;
    bridge.getAllSheetIds = syntheticGetAllSheetIds;
  } else if (isSyntheticGetAllSheetIds(bridge.getAllSheetIds)) {
    delete bridge.getAllSheetIds;
  }
  bridge.getAllTablesInSheet = async () => [];
  bridge.getFiltersInSheet = async () => [];
  bridge.namedRangeCount = async () => 0;
  bridge.getAllNamedRangesWire = async () => [];
  bridge.getHyperlinks = async () => [];
  bridge.getRangeSchemasForSheet = async () => [];
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bindNativeGetAllSheetIds(
  bridge: Record<string, unknown>,
): (() => Promise<unknown>) | undefined {
  const getAllSheetIds = bridge.getAllSheetIds;
  if (typeof getAllSheetIds !== 'function' || isSyntheticGetAllSheetIds(getAllSheetIds)) {
    return undefined;
  }
  return getAllSheetIds.bind(bridge) as () => Promise<unknown>;
}

function isSyntheticGetAllSheetIds(
  value: unknown,
): value is VersionDomainDetectorNoopGetAllSheetIds {
  return (
    typeof value === 'function' &&
    (value as VersionDomainDetectorNoopGetAllSheetIds)[
      VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_GETTER
    ] === true
  );
}
