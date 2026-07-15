/**
 * Public root-barrel DocumentFactory facade.
 *
 * The internal `DocumentFactory` still owns monorepo lifecycle entry points,
 * including the deprecated cooperative host-context path. The public
 * `@mog-sdk/kernel` root must not expose that host-context bypass at runtime.
 */

import { DocumentFactory as InternalDocumentFactory } from './api/document/document-factory';
import {
  callWithPublicSdkErrorBoundary,
  withPublicSdkErrorBoundary,
} from './api/public-sdk-error-boundary';

type PublicDocumentFactory = Pick<
  typeof InternalDocumentFactory,
  'create' | 'createFromXlsx' | 'createFromCsv'
>;

const create: PublicDocumentFactory['create'] = (options) =>
  callWithPublicSdkErrorBoundary(
    'DocumentFactory.create',
    async () => {
      const handle = await InternalDocumentFactory.create(options);
      return withPublicSdkErrorBoundary(handle, 'DocumentHandle');
    },
    'DocumentHandle',
  );

const createFromXlsx: PublicDocumentFactory['createFromXlsx'] = (source, options) =>
  callWithPublicSdkErrorBoundary('DocumentFactory.createFromXlsx', async () => {
    const result = await InternalDocumentFactory.createFromXlsx(source, options);
    if (!result.handle) return result;
    return {
      ...result,
      handle: withPublicSdkErrorBoundary(result.handle, 'DocumentHandle'),
    };
  });

const createFromCsv: PublicDocumentFactory['createFromCsv'] = (source, options) =>
  callWithPublicSdkErrorBoundary('DocumentFactory.createFromCsv', async () => {
    const result = await InternalDocumentFactory.createFromCsv(source, options);
    if (!result.handle) return result;
    return {
      ...result,
      handle: withPublicSdkErrorBoundary(result.handle, 'DocumentHandle'),
    };
  });

export const DocumentFactory: PublicDocumentFactory = Object.freeze({
  create,
  createFromXlsx,
  createFromCsv,
});
