# Mog Repository Instructions

This is the public Mog repository.

## Before Work

- Check `git status --short --branch` before editing.
- Do not use destructive git commands unless explicitly requested.
- Keep private/internal content out of this repository.

## Verification

- Prefer the smallest relevant check for the area changed.
- Common checks:
  - `cargo test -p mog`
  - `cargo test -p compute-api`
  - `cargo check --workspace --locked`

## Boundaries

Public surfaces live in `compute` (engine + Office.js scripting) and
`file-io`. Do not add a Node/N-API host, UI packages, or a custom `wb`/`ws`
scripting API.
