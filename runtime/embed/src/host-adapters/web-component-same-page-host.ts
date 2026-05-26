import type { MogEmbedConfig, MogEmbedHostPolicy } from '../config';
import { createSamePageEmbedHost, type SamePageEmbedHostResult } from './same-page-host';

export type WebComponentEmbedHostResult = SamePageEmbedHostResult;

export function createWebComponentEmbedHost(
  config: MogEmbedConfig,
  hostPolicy: MogEmbedHostPolicy,
  sheet?: number | string,
): Promise<WebComponentEmbedHostResult> {
  return createSamePageEmbedHost(config, hostPolicy, sheet);
}
