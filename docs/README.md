# Mog

Mog is a spreadsheet-native data operating system. This public repository
contains the TypeScript and Rust implementation for the shipped SDK packages,
runtime packages, workspace-internal kernel/app code, compute crates, rendering
packages, and file I/O packages.

Compatibility references to third-party spreadsheet applications, APIs, and
file formats are nominative and governed by [TRADEMARKS.md](../TRADEMARKS.md).

## Start Here

For a runnable path, use the public SDK:

```bash
mkdir mog-quickstart
cd mog-quickstart
npm init -y
npm pkg set type=module
npm install @mog-sdk/sdk
cat > index.mjs <<'JS'
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();

try {
  const ws = wb.activeSheet;

  await ws.setCell('A1', 42);
  await ws.setCell('A2', '=A1*2');

  console.log(await ws.getValue('A2'));
} finally {
  wb.dispose();
}
JS
node index.mjs
```

Expected output:

```text
84
```

`@mog-sdk/sdk` requires Node.js 18 or newer and loads native N-API platform
packages through optional `@mog-sdk/*` binary wrapper packages.

## Public Paths

| Goal | Status | Package or guide |
| --- | --- | --- |
| Run workbook automation in Node.js | public | [`@mog-sdk/sdk`](guides/sdk.md) |
| Use Python bindings from source or a published wheel when available | public-experimental | [`compute/pyo3`](guides/python-sdk.md) |
| Embed a sheet in React | public-experimental | [`@mog-sdk/embed/react`](guides/embed-react.md) |
| Embed a sheet as a web component | public-experimental | [`@mog-sdk/embed`](guides/embed-web-component.md) |
| Mount the full spreadsheet app in a trusted same-origin host | public | [`@mog-sdk/spreadsheet-app`](guides/spreadsheet-app-embed.md) |
| Mount the low-level grid view in custom app chrome | public | [`@mog-sdk/sheet-view`](guides/sheet-view.md) |
| Import shared public contracts and types | public | [`@mog-sdk/contracts`](reference/README.md) |
| Load browser compute runtime assets | public | `@mog-sdk/wasm` binary wrapper |

The public package inventory is checked by
[`tools/package-inventory.jsonc`](../tools/package-inventory.jsonc). The kernel
package, shell package, default spreadsheet app package, and most `@mog/*`
implementation packages are workspace-internal, reserved, or not shipped as
public integration surfaces. Use the SDK/runtime packages above for public
integrations instead of importing those implementation packages directly.
For `@mog-sdk/embed`, the package is public and its React, web-component, and
config subpaths are currently public-experimental.

## Reserved Surfaces

These docs are intentionally present, but the surfaces are not shipped as
customer-facing contracts:

| Surface | Status | Document |
| --- | --- | --- |
| iframe embed | reserved | [iframe Embed](guides/iframe-embed.md) |
| HTTP service API | reserved | [HTTP Service](guides/http-service.md) |
| Self-hosted service distribution | reserved | [Self-Hosting](guides/self-hosting.md) |
| Third-party plugin authoring/distribution | reserved | [Plugins](guides/plugins.md) |

## Architecture And Internals

Start with architecture when you need implementation boundaries rather than a
public integration path:

| Topic | Document |
| --- | --- |
| Architecture overview | [architecture/README.md](architecture/README.md) |
| OS layers | [architecture/os/README.md](architecture/os/README.md) |
| Package inventory and dependency direction | [architecture/os/packages.md](architecture/os/packages.md) |
| TypeScript package boundaries | [architecture/typescript-package-boundaries.md](architecture/typescript-package-boundaries.md) |
| API layer and transport | [architecture/api-layer.md](architecture/api-layer.md) |
| Compute bridge | [architecture/compute-bridge.md](architecture/compute-bridge.md) |
| Compute-core | [../compute/core/README.md](../compute/core/README.md) |
| Spreadsheet internals | [internals/spreadsheet/README.md](internals/spreadsheet/README.md) |
| Drawing system | [../canvas/drawing/README.md](../canvas/drawing/README.md) |

## Security And Governance

Security docs use explicit claim classes and distinguish shipped behavior from
deployment-controlled policy and roadmap items.

| Topic | Document |
| --- | --- |
| Security overview | [security/README.md](security/README.md) |
| Trust model | [security/TRUST-MODEL.md](security/TRUST-MODEL.md) |
| Data flow and network egress | [security/DATA-FLOW-AND-EGRESS.md](security/DATA-FLOW-AND-EGRESS.md) |
| Threat model | [security/THREAT-MODEL.md](security/THREAT-MODEL.md) |
| Access control | [security/ACCESS-CONTROL.md](security/ACCESS-CONTROL.md) |
| Known limitations | [security/KNOWN-LIMITATIONS.md](security/KNOWN-LIMITATIONS.md) |
| Vulnerability disclosure | [../SECURITY.md](../SECURITY.md) |

## Reference

The TypeScript API reference index is in
[reference/README.md](reference/README.md). Generated API data exists in
[`docs/generated/api-reference.json`](generated/api-reference.json), SDK
introspection data exists in
[`runtime/sdk/src/generated/api-spec.json`](../runtime/sdk/src/generated/api-spec.json),
and package API snapshots are stored under
[`tools/api-snapshots`](../tools/api-snapshots/).
