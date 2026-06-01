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

This document separates current repository evidence from release-integrity
claims that require explicit packaging and publishing support.

Status words match the rest of the public docs:

- `shipped`: implemented in the current public repository.
- `public`: exported from a public package or SDK surface.
- `public-experimental`: public or source-visible, but not a stable enterprise
  security boundary.
- `workspace-internal`: present in private workspace packages or adapters, not a
  public SDK contract.
- `reserved`: source or type shapes exist for future use, but the surface is not
  a supported public deployment or release artifact.
- `not shipped`: not implemented or not available as a public contract.

The primary public evidence for package disposition is
`tools/package-inventory.jsonc`, the package manifests under `contracts`,
`views`, `runtime`, `compute/napi/npm`, `compute/wasm/npm`, and `compute/pyo3`,
and the single public GitHub Actions workflow at
`.github/workflows/publish-sdk.yml`.

## Artifact Inventory

| Artifact or surface | Public status | Current repository evidence | Release-integrity status | Not claimed |
|---------------------|---------------|-----------------------------|--------------------------|-------------|
| Public TypeScript npm SDK packages | `public`, shipped. `@mog-sdk/embed` React/web-component/config subpaths are `public-experimental`. | `tools/package-inventory.jsonc` classifies `@mog-sdk/node`, `@mog-sdk/contracts`, `@mog-sdk/sheet-view`, `@mog-sdk/spreadsheet-app`, and `@mog-sdk/embed` as `ship-public`. The publish workflow validates versions, builds public artifacts, assembles package candidates, publishes with `pnpm publish --access public`, and creates SDK GitHub release entries. | Packed npm candidates receive `artifacts/npm-tarballs/SHA256SUMS`, uploaded as the workflow artifact `npm-release-candidates-$VERSION` with 14-day retention. The checksum file is not attached to the GitHub release. | Project-level package signatures, durable release-attached checksums, SBOMs, verified npm provenance attestations, and reproducible builds. |
| N-API npm platform packages | `public` binary-wrapper support packages for `@mog-sdk/node`. | Seven manifests exist under `compute/napi/npm/*`: macOS arm64/x64, Linux x64/arm64 glibc/musl, and Windows x64 MSVC. `@mog-sdk/node` lists them as optional dependencies, and the workflow builds/copies `compute-core-napi.node` into each package before publishing. | They are included in packed npm candidate tarballs and the temporary `SHA256SUMS` workflow artifact. After registry publish, package-manager integrity is available through npm metadata. | Project-level native binary signatures, durable project-published binary checksums, SBOMs, and binary provenance attestations. |
| WASM npm package | `public` binary-wrapper package. | `compute/wasm/npm/package.json` publishes `@mog-sdk/wasm`; `compute/wasm/build.sh` builds the wasm-pack output; the workflow runs the release WASM build and copies the package into assembled public candidates. | Included in packed npm candidate tarballs and the temporary `SHA256SUMS` workflow artifact. After registry publish, package-manager integrity is available through npm metadata. | Project-level WASM signatures, durable project-published checksums, SBOMs, and provenance attestations. |
| Python wheels | `public-experimental` source/package surface. | `compute/pyo3/pyproject.toml` defines the PyPI package `mog-sdk` and import package `mog`; the workflow builds wheels with `maturin` for macOS arm64/x64 and Linux x64/arm64, uploads build artifacts with 3-day retention, publishes to PyPI only when `PYPI_TOKEN` is configured, and creates a Python GitHub release only when publish succeeds. | Registry/local hashes only. The public workflow does not attach wheel checksums or wheels to the GitHub release. | Wheel signatures, durable project-published wheel checksums, SBOMs, PyPI trusted-publishing/provenance claims, and reproducible wheels. |
| Desktop/Tauri bundles | `workspace-internal` adapters; packaged desktop distribution is `not shipped` in this repository. | Tauri transport/platform helper code exists under `infra/platform/tauri`, `infra/transport`, `shell`, and `kernel`, but no `tauri.conf.*` bundle configuration or desktop release workflow is present in the public repo. | No shipped installer/archive artifact is documented here. | Signed installers, notarization, updater policy, OS entitlements, desktop SBOMs, installer checksums, and desktop provenance. |
| GHCR/headless container image | `not shipped`. | The public GitHub Actions configuration contains only `.github/workflows/publish-sdk.yml`; no Dockerfile or container image publish workflow is present outside generated/build output. | No image digest, release artifact, or registry publish evidence is documented here. | GHCR image availability, immutable image digests, image signatures, image SBOMs, and container provenance. |
| Security documentation artifacts | Source manifest is shipped; generated artifacts are `not shipped`. | `docs/security/manifest.json` declares the public Markdown set and intended `dist/trust` output root. The repo has no `dist/trust` directory, public docs build/PDF command, or generator for HTML/PDF/trust-manifest artifacts. | Source Markdown can be reviewed directly. Generated documentation hashes are not produced by this repository. | Generated security-doc HTML/PDF artifacts, artifact hashes, signatures, or a release trust manifest. |

## Current Verification Steps

For JavaScript and Rust dependency inputs, the repository contains
`pnpm-lock.yaml` and `Cargo.lock`. The SDK publish workflow runs
`pnpm install --frozen-lockfile` and installs release helper tools such as
`cargo-zigbuild` and `wasm-pack` with `--locked`, but it uses the Rust `stable`
toolchain channel rather than a repository-pinned Rust toolchain file. Do not
treat the workflow as a reproducible-build claim.

For npm release candidates, the current workflow-level verification is limited
to the short-lived `npm-release-candidates-$VERSION` artifact. When that
workflow artifact is available, the checksum file can be checked inside the
downloaded artifact directory:

```bash
shasum -a 256 -c SHA256SUMS
```

That is not durable customer release evidence because the checksum file is not
attached to the GitHub release or a customer release portal.

For these security documents, `docs/security/manifest.json` declares the public
Markdown set and the intended `dist/trust` output root. The public repository
does not currently include a docs publishing command or generator for generated
HTML, PDFs, or a trust manifest with source/artifact hashes. Mog therefore does
not claim generated security-document artifacts as verified release artifacts in
this repository.

For product binaries, enterprise distribution requires explicit release evidence
before Mog can claim end-to-end artifact verification. Existing workflow evidence
is useful but not yet sufficient for external verification: npm release
candidates receive a `SHA256SUMS` file in CI, and the workflow creates GitHub
release entries, but release verification files are not attached beside registry
artifacts.

- Generate cryptographic checksums for every installer, archive, npm tarball, and native package.
- Attach `SHA256SUMS` and signatures to a durable GitHub release or customer release portal.
- Sign desktop installers with platform-appropriate signing identities.
- Publish an SBOM for bundled JavaScript, Rust crates, native libraries, and platform dependencies.
- Record build provenance: commit, build environment, toolchain versions, and artifact hashes.
- Enable npm provenance and PyPI trusted publishing or equivalent attestations.
- Sign GHCR images and publish immutable digests.
- Document vulnerability intake, triage SLA, patch release process, and customer notification channel.

## Not Claimed Yet

| Claim | Current status | Required before claiming |
|-------|----------------|--------------------------|
| All downloadable binaries are signed. | `not shipped` | Signing configuration and release evidence per platform. |
| Customers can verify every artifact with a durable published checksum. | `not shipped` | Checksum generation and publishing in the release pipeline. |
| An SBOM is available for every release. | `not shipped` | SBOM generator and artifact retention. |
| npm and PyPI artifacts have verified provenance attestations. | `not shipped` | Published attestations or trusted-publishing evidence for each package artifact. |
| Desktop installers, updater artifacts, and OS entitlements are release-verified. | `not shipped` | Final desktop packaging configuration, installer/updater evidence, and platform-specific review. |
| A GHCR/headless container image is signed and published with an immutable digest. | `not shipped` | Supported container distribution, digest publication, image signing, and registry evidence. |
| Builds are reproducible. | Not claimed | Reproducible build design, pinned toolchains, and verification procedure. |
