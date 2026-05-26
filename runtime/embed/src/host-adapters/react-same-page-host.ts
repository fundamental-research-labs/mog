import type { MogEmbedConfig, MogEmbedHostPolicy } from '../config';
import { createSamePageEmbedHost, type SamePageEmbedHostResult } from './same-page-host';

export type ReactEmbedHostResult = SamePageEmbedHostResult;

export function createReactEmbedHost(
  config: MogEmbedConfig,
  hostPolicy: MogEmbedHostPolicy,
  sheet?: number | string,
): Promise<ReactEmbedHostResult> {
  return createSamePageEmbedHost(config, hostPolicy, sheet);
}
