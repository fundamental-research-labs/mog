# Contributing to Mog

Thank you for your interest in contributing to Mog. This guide explains how to get involved.

## Code of Conduct

All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How to Contribute

### Reporting Issues

- Search existing issues before opening a new one.
- Include reproduction steps, expected behavior, and actual behavior.
- For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

### Submitting Changes

1. Fork the repository.
2. Create a feature branch from `dev` (not `main`): `git checkout -b my-feature dev`
3. Make your changes.
4. Run the relevant checks for your change (see Testing below).
5. Commit with a descriptive message following the conventions below.
6. Push your branch and open a pull request against `dev`.

### Pull Request Process

- PRs must target the `dev` branch.
- Include a clear description of what the PR does and why.
- Link to any related issues.
- Feature PRs should pass the relevant fast checks for the area changed.
- `dev` is an integration branch and may be temporarily red while related work lands.
- `main` is the trusted branch. Changes reach `main` through a promotion from `dev` after the full gate is green.
- A maintainer will review your PR. Be prepared for feedback and iteration.

## Development Setup

### Prerequisites

- Node.js (see `.node-version` or `.nvmrc` if present)
- pnpm (see `packageManager` field in root `package.json`)
- Rust toolchain (see `rust-toolchain.toml`)
- wasm-pack (for WASM builds)

### Getting Started

```bash
# Install JS dependencies
pnpm install

# Build the Rust compute core (native)
cargo build --release

# Build WASM artifacts (if working on browser path)
pnpm build:wasm
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for an overview of the system architecture, including the kernel, compute core, views, and platform layers.

The repository follows a layered dependency direction:

```
contracts -> hardware -> kernel -> views -> apps
```

All cell value computation and storage lives in Rust. TypeScript reads viewport buffers but never writes into them.

## Package Boundaries

Mog has strict package boundary rules. Before adding or modifying public exports:

- Check the package's exposure tier (public-experimental, workspace-internal, private, etc.).
- Do not add new public exports to any `@mog-sdk/*` package without maintainer approval.
- Do not import workspace-internal or private packages from public packages.
- Do not use `workspace:*`, `link:`, or source-relative imports in examples or public code.

See the platform plan documentation for the full package boundary specification.

## Code Style and Conventions

### TypeScript

- Follow the existing ESLint and Prettier configuration.
- Use TypeScript strict mode.
- Prefer explicit types over `any`.
- Import from public package entrypoints, not deep internal paths.

### Rust

- Follow `rustfmt` and `clippy` defaults.
- Run `cargo fmt` before committing.
- Run `cargo clippy` and address warnings.

### General

- Keep changes focused. One logical change per PR.
- Write descriptive commit messages (see below).
- Add or update tests for any behavior change.

## Testing

Before submitting a PR, run the smallest relevant checks for your change. For
changes near public APIs, package boundaries, or release-facing behavior, widen
to the applicable full checks:

```bash
# TypeScript type checking
pnpm typecheck

# TypeScript tests
pnpm test

# Rust tests
cargo test

# Rust formatting
cargo fmt --check

# Rust lints
cargo clippy
```

Feature PRs should pass the relevant fast checks before merge to `dev`.
Promotion from `dev` to `main` requires the full gate to be green.

## Commit Conventions

Use conventional commit format:

```
type(scope): short description

Longer explanation if needed.
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`.

Scope is optional but encouraged (e.g., `kernel`, `compute`, `sheet-view`, `embed`, `sdk`).

Examples:
- `feat(kernel): add workbook metadata API`
- `fix(compute): correct VLOOKUP range resolution`
- `docs: update self-hosting guide`

## Developer Certificate of Origin

By contributing to this project, you certify that your contribution is consistent with the [Developer Certificate of Origin](https://developercertificate.org/) (DCO v1.1).

You must sign off each commit:

```bash
git commit -s -m "feat(kernel): add workbook metadata API"
```

This adds a `Signed-off-by` trailer to your commit message, certifying that you have the right to submit the contribution under the project's license.

Commits without a sign-off will be flagged by CI and must be amended before merge.

## RFC Process

For substantial changes to architecture, public APIs, or package boundaries, an RFC (Request for Comments) is required before implementation. The RFC process will be documented separately. In the meantime, open an issue to discuss significant proposals before starting work.

## Trademark

The Mog name, logo, and cat-themed branding are trademarks of Fundamental Research Labs, Inc. See [TRADEMARKS.md](TRADEMARKS.md) for usage guidelines. The MIT license grants rights to the code, not to the trademarks.

## License

By contributing, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers the project.
