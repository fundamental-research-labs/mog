# Plugins

> **Status: reserved.** Mog does not currently ship a supported third-party
> plugin authoring, loading, sandboxing, or distribution surface. Do not use this
> page as a plugin quickstart; there is no public package or manifest flow to
> copy into an external project yet.

## What Exists

The repository contains workspace-internal scaffolding for a future app/plugin
platform:

- `types/app-platform/src/plugin/` defines private contract types for the
  `@mog-sdk/types-app-platform` workspace package. That package is marked
  `private: true` and `workspace-internal` in the current inventory.
- `shell/src/platform/types.ts` contains the shell-local plugin manifest and
  lifecycle types used by the shell platform code today.
- `shell/src/platform/plugin-activation-manager.ts` can register a plugin
  manifest and transition a bundled first-party `same-realm-trusted` plugin
  through activation/deactivation states. It does not dynamically import a
  third-party entry module or provide a public runtime host.
- `shell/src/platform/isolation-enforcer.ts` declares `worker-sandbox`,
  `iframe-sandbox`, and `server-side` plugin isolation modes, but refuses those
  modes with `unsupportedIsolation` until host bridges exist.
- `shell/src/platform/plugin-registry.ts` is intentionally empty: `getPlugin()`
  returns `undefined` and `listPlugins()` returns `[]` until plugin-kind package
  discovery is implemented.

## What Is Not Shipped

- No public plugin SDK package.
- No external plugin manifest format or install command.
- No marketplace, signing, review, or package distribution flow.
- No worker, iframe, or server-side plugin bridge.
- No public extension point for adding spreadsheet formula functions. Formula
  functions are registered in the compute function registry, not through
  plugins.

For the current package and layer model, see
[Architecture Overview](architecture-overview.md), [OS Shell](../architecture/os/shell.md),
and [Package Structure](../architecture/os/packages.md).
