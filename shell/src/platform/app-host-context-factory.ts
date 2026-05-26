/**
 * App Host Context Factory — creates `AppHostContext` for app instances.
 *
 * Assembles the full runtime context that an app entry function receives.
 * All fields are frozen so apps cannot mutate shell-owned state.
 *
 */

import type {
  AppHostContext,
  AppManifest,
  AppResourceBindingSnapshot,
  RouteSnapshot,
  ShellHostServices,
} from './types';

export interface CreateAppHostContextParams {
  instanceId: string;
  manifest: AppManifest;
  route: RouteSnapshot;
  bindings: readonly AppResourceBindingSnapshot[];
  services: ShellHostServices;
  capabilities: readonly string[];
}

export function createAppHostContext(params: CreateAppHostContextParams): AppHostContext {
  const { instanceId, manifest, route, bindings, services, capabilities } = params;

  const context: AppHostContext = {
    instanceId,
    manifest,
    route,
    bindings: Object.freeze([...bindings]),
    services,
    capabilities: Object.freeze([...capabilities]),
  };

  return Object.freeze(context);
}
