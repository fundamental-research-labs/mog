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
| Desktop bundles | Tauri integration dependencies and adapters exist; no `tauri.conf.*` bundle configuration or desktop release workflow is documented here | Not documented | Not documented | Not documented | Not documented | Roadmap |
| Public npm SDK packages | CI builds public release candidates, publishes the package set, and creates GitHub release entries | No project signature; npm provenance not wired | `SHA256SUMS` generated for packed candidates but uploaded only as a short-lived workflow artifact, not attached to the GitHub release | Not documented | Not documented despite workflow `id-token` permission | Roadmap |
| N-API npm platform packages | Platform package manifests exist under `compute/napi/npm/*` | No project-level binary signature | npm integrity available through package manager after publish; durable project-published checksum not documented | Not documented | Not documented | Roadmap |
| WASM npm package | Package exists under `compute/wasm/npm` | Not documented | Package-manager integrity after publish; durable project-published checksum not documented | Not documented | Not documented | Roadmap |
| Python wheels | Built through `maturin` workflow; the publish step uploads to PyPI when `PYPI_TOKEN` is configured and creates a GitHub release entry only when published | Not documented | Registry/local hashes only; durable project-published checksum not documented | Not documented | PyPI trusted publishing/provenance not documented | Roadmap |
| GHCR/headless container image | No container image workflow is present in the public GitHub Actions configuration | Not documented | Not documented | Not documented | Not documented | Roadmap |
| Security documentation artifacts | A source manifest exists at `docs/security/manifest.json`, but no public docs build/PDF command or generator for `dist/trust` is present | Not documented | Generated documentation hashes are not documented in this repository | Not applicable to product binaries | Not applicable to product binaries | Not claimed |

## Current Verification Steps

For these security documents, `docs/security/manifest.json` declares the public Markdown set and the intended `dist/trust` output root. The public repository does not currently include a docs publishing command or generator for generated HTML, PDFs, or a trust manifest with source/artifact hashes. Mog therefore does not claim generated security-document artifacts as verified release artifacts in this repository.

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
