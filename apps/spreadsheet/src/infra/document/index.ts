/**
 * App-local document infra barrel.
 *
 * 01 removed the `SpreadsheetDocumentManager` (a parallel
 * `IDocumentApp` implementation) — its callers now use `deps.platform` for
 * dialogs and `deps.shellService` for document lifecycle. The shell
 * `DocumentManager` (`shell/src/services/document/`) is the canonical
 * document lifecycle service.
 */
export * from './file-type-registry';
