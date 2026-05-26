export const PRODUCT_VOCABULARY = {
  diagram: {
    label: 'Diagram',
    importDescriptor: 'OOXML Diagram',
  },
  textEffects: {
    label: 'Text effects',
    importDescriptor: 'OOXML TextEffect',
    objectLabel: 'text-effect objects',
  },
  commandBar: {
    label: 'Command bar',
  },
  fileMenu: {
    label: 'File menu',
  },
  workbookThemes: {
    label: 'Workbook themes',
  },
  defaultTheme: {
    label: 'Default',
  },
  classicTheme: {
    label: 'Classic',
  },
  filterControl: {
    label: 'Filter control',
  },
  dateFilter: {
    label: 'Date filter',
  },
  importData: {
    label: 'Import data',
  },
  connections: {
    label: 'Connections',
  },
  scenarios: {
    label: 'Scenarios',
  },
  pivotTable: {
    label: 'Pivot table',
  },
} as const;

export type ProductVocabulary = typeof PRODUCT_VOCABULARY;
