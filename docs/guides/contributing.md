# Contributing

This guide covers the local development workflow for public changes in this
repository. For the preferred public contribution path and issue reporting
guidance, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Prerequisites

- Git
- Node.js and pnpm. Public package manifests that declare a Node engine
  currently require Node.js 18 or newer; the checked-in publish workflow pins
  Node.js 24.16.0 and pnpm 11.5.0.
- Rust stable toolchain through `rustup`. The workspace uses Rust edition 2024.
- For WASM work: `rustup target add wasm32-unknown-unknown` and `wasm-pack`.
  Release WASM builds also use `wasm-opt` from Binaryen and `brotli`.
- For native Node binding work: `@napi-rs/cli`, used by `compute/napi` package
  scripts.

## Clone and Install

Install JavaScript dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

Then run the smallest check that covers the package or crate you changed. For
Rust work, use locked workspace checks when possible:

```bash
cargo check --workspace --locked
```

## Repository Structure

Mog is a monorepo with package directories organized by package disposition and
product surface. `pnpm-workspace.yaml`, the root `Cargo.toml`,
`tools/package-inventory.jsonc`, and package manifests are the sources of truth.

| Area | Status | Paths |
| --- | --- | --- |
| Public SDK and embeds | shipped public | `runtime/sdk` (`@mog-sdk/sdk`), `runtime/embed` (`@mog-sdk/embed`), `runtime/spreadsheet-app` (`@mog-sdk/spreadsheet-app`) |
| Public contracts and view package | shipped public | `contracts` (`@mog-sdk/contracts`), `views/sheet-view` (`@mog-sdk/sheet-view`) |
| Binary wrappers | shipped public support packages | `compute/wasm/npm` (`@mog-sdk/wasm`), `compute/napi/npm/*` (`@mog-sdk/*` native packages) |
| Kernel and services | workspace-internal | `kernel`, `kernel/host-internal`, `infra/transport`, `infra/platform` |
| Spreadsheet app implementation | private | `apps/spreadsheet` |
| Shell and shared UI packages | reserved | `shell`, `ui` |
| Canvas, drawing, charts, and table engines | workspace-internal or bundle-only | `canvas`, `charts`, `table-engine`, `typeset` |
| Rust compute and file I/O | workspace-internal implementation | `compute`, `file-io`, `domain-types` |
| Tooling, generated assets, and docs | workspace-internal support | `tools`, `infra`, `fixtures`, `docs` |

## Development Workflow

### Running the App Locally

The first-party spreadsheet dev app lives in `dev/app` and can be started from
the repo root:

```bash
pnpm dev
```

It serves `http://localhost:3002`. For other package-specific surfaces, use the
package-level dev script for the surface you are changing, then widen to
repo-level checks before opening a pull request.

### Running Tests

Run the smallest relevant test command for the changed package. Current public
package examples include:

```bash
pnpm --filter @mog-sdk/sdk test
pnpm --filter @mog-sdk/embed test
pnpm --filter @mog-sdk/sheet-view test
pnpm --filter @mog-sdk/spreadsheet-app test
```

For broader TypeScript coverage, run the root scripts:

```bash
pnpm typecheck
pnpm test
```

`pnpm test` is a curated root aggregate from `package.json`; it does not replace
package-specific tests for every public runtime package.

For Rust compute changes, run the targeted crate checks first:

```bash
cargo check -p compute-core --lib --locked
cargo test -p compute-core --locked
```

### Building Generated and Binary Artifacts

If a change affects public package artifacts, run the public artifact build
before SDK or external fixture checks:

```bash
pnpm build:public-artifacts
```

That root script builds public TypeScript facades, builds `@mog-sdk/wasm` through
`bash compute/wasm/build.sh --profile release`, and verifies the host native
`@mog-sdk/*` binary wrapper. For local browser iteration, the narrower WASM
script also supports:

```bash
bash compute/wasm/build.sh --profile dev
bash compute/wasm/build.sh --profile release
```

If a Rust bridge annotation or bridge type changes, regenerate the checked-in
bridge artifacts with:

```bash
pnpm generate:bridge
```

### Linting and Formatting

Use the root scripts for repository-wide JavaScript and TypeScript checks:

```bash
pnpm check:ci:format
pnpm check:ci:lint
pnpm check:ci:typecheck
pnpm check:ci:public-boundaries
```

Use `cargo fmt`, `cargo clippy`, and the relevant `cargo check` or `cargo test`
command for Rust changes.

### Package Boundaries

Before adding or changing an exported TypeScript surface, check:

- `tools/package-inventory.jsonc` for package disposition.
- The package's `package.json` `exports`, runtime dependencies, and `private`
  field.
- The package's `tsconfig.json` references.
- [TypeScript Package Boundaries](../architecture/typescript-package-boundaries.md).

Use shipped public packages in external examples: `@mog-sdk/sdk`,
`@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/sheet-view`, and
`@mog-sdk/contracts`. `@mog-sdk/kernel` is workspace-internal even though some
monorepo subpaths are classified for controlled internal use. `@mog/shell` and
`@mog/ui` are reserved, not shipped public packages.

## Making Changes

### Branch Naming

Use the active versioned development branch for this repository version unless
a task explicitly names another branch. Do not base new public work on
unversioned local or remote development branches.

For normal pull-request work, use a short branch name that describes the public
change, such as `docs/contributing-workflow` or `fix/sdk-disposal-error`.

### Commit Messages

Use concise, imperative commit messages:

```text
docs: clarify public contribution workflow
fix: reject disposed workbook reads
```

### Pull Requests

Open pull requests against the current versioned development branch for the
active release line.

Include:

- What changed and why.
- The user-facing or package-facing surface affected.
- The verification commands you ran.
- Any checks you intentionally did not run and why.

Before publishing the PR, run the fast public readiness gate when the change
touches public package boundaries, package names, or release-facing docs:

```bash
pnpm check:publish-readiness:fast
```

## Architecture Orientation

Start with [Architecture Overview](architecture-overview.md) for the layer model,
then use [Architecture](../architecture/README.md) for detailed subsystem notes.

## Common Tasks

- Add a new formula function: start in
  `compute/core/crates/compute-functions` and cover it in the relevant crate
  tests or `compute/core/tests`.
- Add a new workbook or worksheet API method: start with the owning contract in
  `contracts`/`types`, then implement the facade in `kernel/src/api`. If the
  method is Rust-backed, check the annotated Rust bridge surface in
  `compute/core` and the generated TypeScript bridge files under
  `kernel/src/bridges/compute`; the generator lives in
  `infra/rust-bridge/bridge-ts`.
- Change a public runtime package: start in `runtime/sdk` for
  `@mog-sdk/sdk`, `runtime/embed` for lower-level browser embeds,
  `runtime/spreadsheet-app` for the full app embed, or `views/sheet-view` for
  the low-level grid view.
- Fix a rendering bug: start in `canvas` for drawing/grid internals,
  `views/sheet-view` for the public view package, or `apps/spreadsheet` for app
  chrome and product workflows.

## Related Docs

- [Architecture Overview](architecture-overview.md) — platform layers
- [Package Structure](../architecture/os/packages.md) — package inventory notes
- [CI Gates](../development/ci-gates.md) — current root checks and publish gates
- [TypeScript Package Boundaries](../architecture/typescript-package-boundaries.md) — package boundary rules
- [Security Documentation](../security/README.md) — security and trust-center docs
