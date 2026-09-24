# Releasing the native CLI

The release unit is `mog` in `compute/officejs`. Internal Rust crates remain
unpublished. The npm name stays `@mog-sdk/cli`; it contains only a launcher and
exact-version optional dependencies on native binary packages.

## Preparation

1. Set `compute/officejs/Cargo.toml` to the release version and update the `mog`
   entry in `Cargo.lock`. This is the only version source for all release assets.
2. Update `docs/release-notes-1.0.md`, the README, and installation/migration docs.
   The website is maintained separately; keep its installation copy consistent.
3. Run `cargo test -p mog --locked` and `cargo check --workspace --locked`.
   The normal CI also runs workspace tests and Calipers verification.
4. Run the **Release** workflow without a tag (`workflow_dispatch`). It builds
   and tests all five native targets, tests offline npm installs and sessions,
   checks native/npm binary equality, and uploads `mog-release`. It publishes
   nothing. Release-related pull requests run the same build matrix.
5. Review the artifacts and all CI results before tagging. The binaries are
   unsigned; code signing and macOS notarization are not configured.

`scripts/release/targets.json` defines the supported platforms and build runners.
Linux baselines and macOS deployment targets are documented in
[installation](guides/installation.md). No musl or Windows ARM64 build is promised.

## First-time npm setup

The platform packages are new:

- `@mog-sdk/cli-linux-x64`
- `@mog-sdk/cli-linux-arm64`
- `@mog-sdk/cli-darwin-x64`
- `@mog-sdk/cli-darwin-arm64`
- `@mog-sdk/cli-win32-x64`

The publisher must have access to `@mog-sdk/cli` and permission to create public
packages in the `@mog-sdk` scope. For the first publication, set a suitable
**granular npm token** as `NPM_TOKEN` in the repository's `npm-production`
environment. Its settings must allow the intended CI publication, including any
applicable 2FA policy. No credentials belong in Git.

Once the packages exist, configure npm trusted publishing for all six packages:
GitHub owner `fundamental-research-labs`, repository `mog`, workflow
`publish-cli.yml`, environment `npm-production`. The old SDK publisher binding
is not sufficient for this new workflow. After verifying OIDC publication,
remove the bootstrap token. The workflow grants `id-token: write` for OIDC and
provenance. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Publish

After review and merge, tag the exact tested commit:

```sh
git tag v1.0.0 <reviewed-commit>
git push origin v1.0.0
```

The **Release** workflow checks the tag against Cargo, rebuilds and verifies
artifacts, and creates a **draft** GitHub release containing native archives,
npm tarballs, and `SHA256SUMS`. Review the draft and checksums. Publishing that
GitHub release triggers **Publish CLI to npm**, subject to the `npm-production`
environment's protection rules. Platform packages publish before the launcher.
The publisher permits a retry only when already-published packages have the
exact same integrity hash. It never overwrites published versions.

If draft creation fails after an earlier draft was created, inspect that draft
before changing it. If npm publication fails partway through, fix the credential
or service problem and rerun the failed publish job. Do not rebuild or replace
release assets after any package has been published.

After publication:

```sh
npm view @mog-sdk/cli@1.0.0 version optionalDependencies
npx --yes @mog-sdk/cli@1.0.0 --version
```

Check downloads and installed binaries on the supported platforms. Then replace
release-pending copy in README, installation docs, and the website with the
published install instructions. Website source changes and production deployment
are reviewed separately; no npm or website publication happens on a branch push.

## Local packaging check

Python 3.11+, Node.js 22+, and npm are needed for packaging, not for the standalone
CLI. From the repository root, substitute your native target triple:

```sh
cargo build -p mog --release --locked --target aarch64-unknown-linux-gnu
python3 scripts/release/package.py --target aarch64-unknown-linux-gnu \
  --binary target-native/aarch64-unknown-linux-gnu/release/mog
python3 scripts/release/package.py
python3 scripts/release/smoke.py --target aarch64-unknown-linux-gnu
```

The smoke check installs local tarballs offline with install scripts disabled,
runs Office.js, verifies errors and version output, and opens/edits/closes a
session through the launcher. With the full matrix downloaded into
`artifacts/release`, `python3 scripts/release/publish.py --dry-run` validates
publication without publishing. Keep artifacts from different versions separate.
