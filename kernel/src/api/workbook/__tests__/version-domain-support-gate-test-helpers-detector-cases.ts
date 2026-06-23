export const DETECTOR_SHEET_ID = 'sheet-detector-1';

export const MUTABLE_DOMAIN_DETECTOR_CASES = [
  {
    label: 'tables',
    detectorId: 'detector.tables',
    matrixRowId: 'tables',
    domainId: 'tables',
    missingMethods: ['getAllTablesInSheet'],
    throwingMethod: 'getAllTablesInSheet',
  },
  {
    label: 'filters',
    detectorId: 'detector.filters.auto-filter',
    matrixRowId: 'filters.auto-filter',
    domainId: 'filters',
    missingMethods: ['getFiltersInSheet'],
    throwingMethod: 'getFiltersInSheet',
  },
  {
    label: 'named ranges',
    detectorId: 'detector.named-ranges',
    matrixRowId: 'named-ranges',
    domainId: 'named-ranges',
    missingMethods: ['namedRangeCount', 'getAllNamedRangesWire'],
    throwingMethod: 'namedRangeCount',
  },
  {
    label: 'links',
    detectorId: 'detector.external-links',
    matrixRowId: 'external-links',
    domainId: 'external-links',
    missingMethods: ['getHyperlinks'],
    throwingMethod: 'getHyperlinks',
  },
  {
    label: 'data validation',
    detectorId: 'detector.data-validation',
    matrixRowId: 'data-validation',
    domainId: 'data-validation',
    missingMethods: ['getRangeSchemasForSheet'],
    throwingMethod: 'getRangeSchemasForSheet',
  },
] as const;

export const SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES = [
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[0],
    rowReadMethod: 'getAllTablesInSheet',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[1],
    rowReadMethod: 'getFiltersInSheet',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[3],
    rowReadMethod: 'getHyperlinks',
  },
  {
    detector: MUTABLE_DOMAIN_DETECTOR_CASES[4],
    rowReadMethod: 'getRangeSchemasForSheet',
  },
] as const;

export type MutableDomainDetectorCase = (typeof MUTABLE_DOMAIN_DETECTOR_CASES)[number];
