# @mog-sdk/embed Exposure Classification

Per public package boundary (`the public package boundary contract`) and
public embed protocol (`the embed product matrix`) WP2.

## Entrypoint Exposure Summary

| Entrypoint   | Subpath       | Exposure Tier              | Notes                                                    |
|------------- |-------------- |--------------------------- |--------------------------------------------------------- |
| Root         | `.`           | `public-experimental`      | Web component registration, config types, embed types    |
| React        | `./react`     | `public-experimental`      | `<MogSheet />` component over host-resolved source/policy |
| Web Component | `./web-component` | `public-experimental` | Custom element over host-resolved source/policy          |
| Client       | `./client`    | `bundled-implementation`   | Source-internal only; not a package export               |
| Iframe       | `./iframe`    | `reserved`                 | Source-internal only; not a package export               |
| Publish      | `./publish`   | `reserved`                 | Source-internal only; not a package export               |
| Config       | `./config`    | `public-experimental`      | Config types and helpers only                            |
| Views Host   | `./internal/views-host` | `workspace-private-friend` | Dev/eval friend surface for `@mog/views-host`; stripped from public packs |

## Exported Symbols by Entrypoint

### `.` (root) -- `public-experimental`

| Symbol                         | Kind     | Tier                        |
|------------------------------- |--------- |---------------------------- |
| `EmbedStatus`                  | type     | `public-experimental`       |
| `EmbedRendererOptions`         | type     | `public-experimental`       |
| `EmbedEventMap`                | type     | `public-experimental`       |
| `MogSheetElement`              | class    | `public-experimental`       |
| `EmbedMode`                    | type     | `public-experimental`       |
| `MogEmbedSourceRef`            | type     | `public-experimental`       |
| `MogEmbedChromeOptions`        | type     | `public-experimental`       |
| `MogEmbedThemeOptions`         | type     | `public-experimental`       |
| `MogEmbedSavePolicy`           | type     | `public-experimental`       |
| `MogEmbedCollaborationMode`    | type     | `public-experimental`       |
| `MogEmbedConfig`               | type     | `public-experimental`       |
| `MogEmbedEffectiveState`       | type     | `public-experimental`       |
| `MogEmbedResolvedSource`       | type     | `public-experimental`       |
| `MogEmbedHostPolicy`           | type     | `public-experimental`       |
| `MogEmbedLifecycleState`       | type     | `public-experimental`       |
| `MogEmbedEventMap`             | type     | `public-experimental`       |
| `SDK_VERSION`                  | const    | `public-experimental`       |

### `./react` -- `public-experimental`

| Symbol                | Kind      | Tier                   |
|---------------------- |---------- |----------------------- |
| `MogSheet`            | component | `public-experimental`  |
| `MogSheetProps`       | type      | `public-experimental`  |
| `MogSheetHandle`      | type      | `public-experimental`  |
| `MogSheetSelection`   | type      | `public-experimental`  |
| `MogSheetChange`      | type      | `public-experimental`  |
| `EmbedStatus`         | type      | `public-experimental`  |
| `EmbedMode`           | type      | `public-experimental`  |
| `MogEmbedSourceRef`   | type      | `public-experimental`  |
| `MogEmbedChromeOptions` | type    | `public-experimental`  |
| `MogEmbedThemeOptions` | type     | `public-experimental`  |
| `MogEmbedSavePolicy`  | type      | `public-experimental`  |
| `MogEmbedCollaborationMode` | type | `public-experimental`  |
| `MogEmbedConfig`      | type      | `public-experimental`  |
| `MogEmbedEffectiveState` | type   | `public-experimental`  |
| `MogEmbedResolvedSource` | type   | `public-experimental`  |
| `MogEmbedHostPolicy`  | type      | `public-experimental`  |
| `MogEmbedLifecycleState` | type   | `public-experimental`  |
| `MogEmbedEventMap`    | type      | `public-experimental`  |

### `./web-component` -- `public-experimental`

| Symbol                         | Kind     | Tier                  |
|------------------------------- |--------- |---------------------- |
| `MogSheetElement`              | class    | `public-experimental` |
| `EmbedMode`                    | type     | `public-experimental` |
| `MogEmbedConfig`               | type     | `public-experimental` |
| `MogEmbedEffectiveState`       | type     | `public-experimental` |
| `MogEmbedResolvedSource`       | type     | `public-experimental` |
| `MogEmbedHostPolicy`           | type     | `public-experimental` |
| `MogEmbedLifecycleState`       | type     | `public-experimental` |
| `MogEmbedEventMap`             | type     | `public-experimental` |

### `./client` -- `bundled-implementation`

Not exported from `runtime/embed/package.json`.

| Symbol             | Kind  | Tier                      |
|------------------- |------ |-------------------------- |
| `MogClient`        | class | `bundled-implementation`  |
| `MogClientOptions` | type  | `bundled-implementation`  |

### `./iframe` -- `reserved`

Not exported from `runtime/embed/package.json`.

| Symbol                     | Kind     | Tier       |
|--------------------------- |--------- |----------- |
| `PROTOCOL_VERSION`         | const    | `reserved` |
| `SUPPORTED_VERSIONS`       | const    | `reserved` |
| `MogEmbedMessage`          | type     | `reserved` |
| `MogEmbedMessageType`      | type     | `reserved` |
| `CorrelationTimeoutError`  | class    | `reserved` |
| `VersionMismatchError`     | class    | `reserved` |
| `createMessage`            | function | `reserved` |
| `isValidMessage`           | function | `reserved` |
| `validateMessagePayload`   | function | `reserved` |
| `negotiateVersion`         | function | `reserved` |
| `validateOrigin`           | function | `reserved` |
| `MogIframeClient`          | class    | `reserved` |
| `MogIframeClientOptions`   | type     | `reserved` |
| `ParentEventMap`           | type     | `reserved` |
| `MogIframeHost`            | class    | `reserved` |
| `MogIframeHostOptions`     | type     | `reserved` |

### `./publish` -- `reserved`

Not exported from `runtime/embed/package.json`.

| Symbol                           | Kind     | Tier       |
|--------------------------------- |--------- |----------- |
| `PublishCachePolicy`             | type     | `reserved` |
| `PublishSecurityPolicy`          | type     | `reserved` |
| `PublishMetadata`                | type     | `reserved` |
| `MogPublishArtifact`            | type     | `reserved` |
| `MogPublishConfig`              | type     | `reserved` |
| `PublishChromeOptions`           | type     | `reserved` |
| `MogPublishEffectiveState`      | type     | `reserved` |
| `PublishViewStatus`              | type     | `reserved` |
| `PublishViewHandle`              | type     | `reserved` |
| `PublishViewEventMap`            | type     | `reserved` |
| `createPublishView`             | function | `reserved` |
| `validatePublishConfig`         | function | `reserved` |
| `createDefaultSecurityPolicy`   | function | `reserved` |

### `./config` -- `public-experimental`

| Symbol                         | Kind     | Tier                  |
|------------------------------- |--------- |---------------------- |
| `EmbedMode`                    | type     | `public-experimental` |
| `MogEmbedSourceRef`            | type     | `public-experimental` |
| `MogEmbedChromeOptions`        | type     | `public-experimental` |
| `MogEmbedThemeOptions`         | type     | `public-experimental` |
| `MogEmbedSavePolicy`           | type     | `public-experimental` |
| `MogEmbedCollaborationMode`    | type     | `public-experimental` |
| `MogEmbedConfig`               | type     | `public-experimental` |
| `MogEmbedEffectiveState`       | type     | `public-experimental` |
| `MogEmbedResolvedSource`       | type     | `public-experimental` |
| `MogEmbedHostPolicy`           | type     | `public-experimental` |
| `MogEmbedLifecycleState`       | type     | `public-experimental` |
| `MogEmbedEventMap`             | type     | `public-experimental` |

No runtime values are exported from `./config`; public source materialization
must be performed by a `MogEmbedHostPolicy`, not by direct URL fetching,
callback-name invocation, or inline byte props.

## Tier Promotion Prerequisites

### `public-experimental` -> `public-stable`

- public package boundary packed-artifact gates pass (pack, install, typecheck, import, run from outside pnpm workspace)
- Public declaration output is self-contained (no leaked `@mog-sdk/contracts` or workspace-only types)
- Semver compatibility policy established in open-source distribution plan

### `bundled-implementation` -> `public-experimental`

- Client subpath: must stop exposing raw `Workbook`/`Worksheet`/`ViewportRegion` kernel types; wrap behind a public handle abstraction
- Renderer/orchestrator: must not expose `SheetView` internals or `@mog-sdk/sheet-view` dependency
- Resolution engine: must formalize trust context API independent of internal iframe plumbing

### `reserved` -> `public-experimental`

- `./iframe`: public embed protocol iframe hardening and production-path verification gates pass
- Full spreadsheet app embedding is not an `@mog-sdk/embed` subpath. It is owned
  by `@mog-sdk/spreadsheet-app` and must pass that package's public
  contract gates before public readiness is claimed.

## Forbidden Internal Leaks

The following must NOT appear in public (`public-experimental` or higher) declaration output:

- `DocumentContext` -- internal kernel document management
- `ComputeBridge` -- internal Rust/WASM bridge plumbing
- Raw provider types (`DocumentProvider`, `StorageProvider`, etc.)
- Renderer caches (`RenderCache`, `ViewportCache`, `TileCache`, etc.)
- `@mog-sdk/contracts` in packed manifest `dependencies`
- `@mog-sdk/kernel` in packed manifest `dependencies`
- `@mog-sdk/sheet-view` in packed manifest `dependencies`
- `@mog-sdk/types-host` in packed manifest `dependencies`
- Any `@mog/*` legacy namespace imports
- Raw public source props or helpers (`src: string | Uint8Array | ArrayBuffer`,
  `EmbedSource`, `sourceRefFromLegacy`, direct `fetch(source)`)
- Effective mode/capability/save/collaboration state synthesized from caller
  requests instead of `MogEmbedHostPolicy` or iframe-child policy resolution
