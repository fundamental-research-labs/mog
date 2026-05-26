# Contributing

> **Status: skeleton — content pending package stabilization**

How to contribute to Mog. This guide covers developer environment setup and workflow. For contribution policies (CLA, code of conduct, review process), see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Prerequisites

- Git
- Node.js 20+ and pnpm
- Rust stable toolchain (rustup)
- wasm-pack (for building WASM targets)

## Clone and Build

How to clone the repository, install dependencies, and build all packages. Expected build time and system requirements.

```bash
# example: git clone, pnpm install, build steps
```

## Repository Structure

Top-level directory layout: `packages/` (TypeScript), `crates/` (Rust), `docs/`, and `infra/`. How to navigate the monorepo.

## Development Workflow

### Running the App Locally

Start the development server, open the spreadsheet app in a browser. Hot module replacement behavior.

### Running Tests

Unit tests (Rust: `cargo test`, TypeScript package tests) and integration tests.

### Building WASM

How to rebuild the WASM bridge after Rust changes. Common pitfalls (stale artifacts, target directory layout).

### Linting and Formatting

ESLint, Prettier (TypeScript). `cargo fmt`, `cargo clippy` (Rust). Pre-commit hooks.

## Making Changes

### Branch Naming

Convention for branch names. Feature branches, fix branches.

### Commit Messages

Commit message format. Conventional commits if applicable.

### Pull Requests

PR target branch (`dev`, not `main`). What to include in the PR description. Review process.

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
