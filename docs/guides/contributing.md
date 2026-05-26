# Contributing

This guide covers the local workflow for making public changes in this
repository. For contribution policies, see the root
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Prerequisites

- Git
- Node.js 20+ and pnpm
- Rust stable toolchain (rustup)
- wasm-pack (for building WASM targets)

## Clone and Build

Install JavaScript dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

For Rust work, use locked workspace checks when possible:

```bash
cargo check --workspace --locked
```

## Repository Structure

Mog is a monorepo with package directories organized by product surface:

| Area | Paths |
| --- | --- |
| Public SDK contracts | `contracts`, `types` |
| Kernel and services | `kernel` |
| Runtime and embeds | `runtime`, `views` |
| Spreadsheet app | `apps/spreadsheet`, `shell` |
| Canvas and rendering | `canvas`, `charts` |
| Compute and file I/O | `compute`, `file-io`, `table-engine` |
| Tooling and docs | `tools`, `infra`, `docs` |

## Development Workflow

### Running the App Locally

Use the package-level script for the app or surface you are changing. Prefer a
targeted command first, then widen to repo-level checks before opening a pull
request.

### Running Tests

Run the smallest relevant test command for the changed package:

```bash
pnpm --filter @mog-sdk/node test
pnpm --filter @mog-sdk/embed test
pnpm --filter @mog-sdk/sheet-view test
```

For broader TypeScript coverage, run:

```bash
pnpm typecheck
pnpm test
```

For Rust compute changes, run the targeted crate checks first:

```bash
cargo check -p compute-core --lib --locked
cargo test -p compute-core --locked
```

### Building WASM

If a Rust change affects generated bridge artifacts, rebuild the public
artifacts before running SDK or external fixture checks:

```bash
pnpm build:public-artifacts
```

### Linting and Formatting

Use the root scripts for repository-wide JavaScript and TypeScript checks:

```bash
pnpm check:ci:format
pnpm check:ci:lint
pnpm check:ci:typecheck
pnpm check:ci:public-boundaries
```

Use `cargo fmt` and the relevant `cargo check` or `cargo test` command for Rust
changes.

## Making Changes

### Branch Naming

Use short names that describe the public change, such as
`docs/contributing-workflow` or `fix/sdk-disposal-error`.

### Commit Messages

Use concise, imperative commit messages:

```text
docs: clarify public contribution workflow
fix: reject disposed workbook reads
```

### Pull Requests

Open pull requests against `dev`.

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

Start with [Architecture Overview](architecture-overview.md) to understand the layer model. Key files to read when onboarding to a specific area.

## Common Tasks

- Add a new formula function — where to add it in compute-core, how to test
- Add a new API method — kernel API layer, bridge type generation
- Fix a rendering bug — canvas/drawing packages, SheetView

## Related Docs

- [Architecture Overview](architecture-overview.md) — platform layers
- [TypeScript Package Boundaries](../TYPESCRIPT-PACKAGE-BOUNDARIES.md) — package boundary rules
- [Security Documentation](../security/README.md) — security and trust-center docs
