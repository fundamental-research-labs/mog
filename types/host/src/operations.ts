export type HostDocumentOperation =
  | 'create'
  | 'open'
  | 'import'
  | 'share'
  | 'export'
  | 'delete'
  | 'destroy';

export type HostExportFormat = 'xlsx' | 'csv' | 'pdf' | 'snapshot';
