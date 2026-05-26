---
title: Supply Chain and Release Integrity
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [release, architecture]
---

# Supply Chain and Release Integrity

This document separates current implementation evidence from release-integrity claims that require explicit packaging and publishing support.

## Artifact Inventory

| Artifact | Current evidence | Signing status | Checksum status | SBOM status | Provenance status | Claim class |
|----------|------------------|----------------|-----------------|-------------|-------------------|-------------|
| Desktop bundles | Tauri bundle configuration exists with `targets: all`; a release workflow for desktop bundles is not documented here | Not documented | Not documented | Not documented | Not documented | Roadmap |
| Public npm SDK packages | CI builds public release candidates, publishes the package set, and creates GitHub release entries | No project signature; npm provenance not wired | `SHA256SUMS` generated for packed candidates but uploaded only as a short-lived workflow artifact, not attached to the GitHub release | Not documented | Not documented despite workflow `id-token` permission | Roadmap |
| N-API npm platform packages | Platform package manifests exist under `compute/napi/npm/*` | No project-level binary signature | npm integrity available through package manager after publish; durable project-published checksum not documented | Not documented | Not documented | Roadmap |
| WASM npm package | Package exists under `compute/wasm/npm` | Not documented | Package-manager integrity after publish; durable project-published checksum not documented | Not documented | Not documented | Roadmap |
| Python wheels | Built through `maturin` workflow, uploaded to PyPI, and paired with a GitHub release entry | Not documented | Registry/local hashes only; durable project-published checksum not documented | Not documented | PyPI trusted publishing/provenance not documented | Roadmap |
| GHCR headless image | Container workflow pushes tags | Not documented | Digest exists in registry but not published as release verification evidence | Not documented | Not documented | Roadmap |
| Security documentation artifacts | `pnpm docs:build` emits trust-center HTML files and a manifest; `pnpm docs:pdf` emits PDF files | Git commit identity recorded in the generated manifest | Source and generated HTML hashes are recorded in `dist/trust/manifest.json`; PDF hashes are not recorded today | Not applicable to product binaries | Not applicable to product binaries | Verified for documentation artifacts only |

## Current Verification Steps

For these security documents, `pnpm docs:build` emits `dist/trust/manifest.json` containing source hashes, artifact hashes, commit hash, and build time. That proves the generated trust-center documentation artifacts match the reviewed Markdown content at a specific commit; it does not prove integrity for installers, npm packages, Python wheels, containers, or native binaries.

For product binaries, enterprise distribution requires explicit release evidence before Mog can claim end-to-end artifact verification. Existing workflow evidence is useful but not yet sufficient for external verification: npm release candidates receive a `SHA256SUMS` file in CI, and the workflow creates GitHub release entries, but release verification files are not attached beside registry artifacts.

- Generate cryptographic checksums for every installer, archive, npm tarball, and native package.
- Attach `SHA256SUMS` and signatures to a durable GitHub release or customer release portal.
- Sign desktop installers with platform-appropriate signing identities.
- Publish an SBOM for bundled JavaScript, Rust crates, native libraries, and platform dependencies.
- Record build provenance: commit, build environment, toolchain versions, and artifact hashes.
- Enable npm provenance and PyPI trusted publishing or equivalent attestations.
- Sign GHCR images and publish immutable digests.
- Document vulnerability intake, triage SLA, patch release process, and customer notification channel.

## Not Claimed Yet

| Claim | Classification | Required before claiming |
|-------|----------------|--------------------------|
| All downloadable binaries are signed. | Roadmap | Signing configuration and release evidence per platform. |
| Customers can verify every artifact with a published checksum. | Roadmap | Checksum generation and publishing in the release pipeline. |
| An SBOM is available for every release. | Roadmap | SBOM generator and artifact retention. |
| Builds are reproducible. | Not claimed | Reproducible build design, pinned toolchains, and verification procedure. |
