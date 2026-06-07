// Host-adapter subpaths are internal implementation details and must not
// resolve outside the monorepo. These paths are not in any package "exports".

// @mog-sdk/embed host-adapters must fail
import { ReactSamePageHost } from '@mog-sdk/embed/host-adapters/react-same-page-host';
import { IframeChildHost } from '@mog-sdk/embed/host-adapters/iframe-child-host';

// @mog-sdk/sdk host-adapters must fail
import { NodeHeadlessHost } from '@mog-sdk/sdk/host-adapters/node-headless-host';
