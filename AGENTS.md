# Mog Repository Instructions

This is the public Mog repository.

## Before Work

- Check `git status --short --branch` before editing.
- Do not use destructive git commands unless explicitly requested.
- Keep private/internal content out of this repository.

## Verification

- Prefer the smallest relevant check for the area changed.
- Common checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm check:publish-readiness:fast`
  - `cargo check --workspace --locked`

## Boundaries

- Public packages and SDK surfaces live in `contracts`, `kernel`, `runtime`,
  `views`, `compute`, and package-specific directories.
- Do not add dependencies on `mog-internal` or private-only packages.
