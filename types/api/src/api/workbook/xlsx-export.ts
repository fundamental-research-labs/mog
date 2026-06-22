export interface WorkbookXlsxExportOptions {
  /**
   * Internal import/export verification mode that disables imported
   * RoundTripContext preservation so corpus gates can prove modeled facts do
   * not depend on stale source package bytes.
   */
  readonly contextStripped?: boolean;

  /**
   * Controls Mog-owned version metadata sidecar export.
   *
   * Default export omits Mog version metadata. `include` writes a redacted
   * package sidecar containing document identity and the current version head.
   */
  readonly versionMetadata?: 'include' | 'omit';
}
