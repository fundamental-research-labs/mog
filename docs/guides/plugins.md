# Plugins

> **Reserved** — Mog does not currently expose a supported third-party plugin authoring or distribution surface. The repository contains workspace-internal app/plugin contract types and shell lifecycle scaffolding, but plugin-kind package discovery, sandbox bridges, and marketplace distribution are not public features.

Current implementation notes for contributors:

- Workspace-internal plugin contracts live under `types/app-platform/src/plugin/`.
- Shell lifecycle scaffolding lives under `shell/src/platform/plugin-activation-manager.ts`.
- `worker-sandbox`, `iframe-sandbox`, and `server-side` isolation modes are declared but refused until host bridges ship.
- The shell plugin registry is an empty stub until plugin-kind packages are supported.
- Formula functions are added in the compute function registry, not via plugins.

See [Architecture Overview](architecture-overview.md) for the layer model that plugins extend.
