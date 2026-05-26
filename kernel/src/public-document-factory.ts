/**
 * Public root-barrel DocumentFactory facade.
 *
 * The internal `DocumentFactory` still owns monorepo lifecycle entry points,
 * including the deprecated cooperative host-context path. The public
 * `@mog-sdk/kernel` root must not expose that host-context bypass at runtime.
 */

import { DocumentFactory as InternalDocumentFactory } from './api/document/document-factory';

type PublicDocumentFactory = Pick<
  typeof InternalDocumentFactory,
  'create' | 'createFromXlsx' | 'createFromCsv'
>;

export const DocumentFactory: PublicDocumentFactory = Object.freeze({
  create: InternalDocumentFactory.create,
  createFromXlsx: InternalDocumentFactory.createFromXlsx,
  createFromCsv: InternalDocumentFactory.createFromCsv,
});
