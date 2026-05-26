/**
 * @mog-sdk/types-document — Document lifecycle, comments, search, storage,
 * filesystem, security, platform, and app types.
 *
 * Tier 1 leaf of the domain graph. Depends only on @mog/types-core.
 *
 * Contains (absorbed from contracts/src/):
 * - document/  — comments, document (lifecycle), search (NOT protection, which lives in types-core)
 * - storage/   — capabilities, connection, query, table-driver
 * - filesystem/ — paths, permissions, types (IFileSystem etc.)
 * - security/  — evaluator, types (data access policies)
 * - platform/  — identity, types (IPlatform, INotifications, etc.)
 * - app/       — types (IApp, IDocument, IDocumentApp, AppManifest)
 *
 * NOTE: This root barrel intentionally does NOT `export *` from every sub-barrel
 * because the inherited folder layout has name collisions across folders
 * (e.g. `Unsubscribe` in storage + filesystem, `AppId` in filesystem + app).
 * Consumers should import from the precise subpath:
 *
 *   import type { SearchOptions } from '@mog-sdk/types-document/document';
 *   import type { IFileSystem } from '@mog-sdk/types-document/filesystem';
 *
 * Matches the pre-existing contracts/src/ import style.
 */

export {};
