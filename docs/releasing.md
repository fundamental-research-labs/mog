# Releasing the native CLI

The release unit is `mog` in `compute/officejs`. Internal Rust crates remain
unpublished. The npm package is `@mog-sdk/cli`; it contains only a launcher and
exact-version optional dependencies on native binary packages.

## Preparation

1. Set `compute/officejs/Cargo.toml` to the release version and update the `mog`
   entry in `Cargo.lock`. This is the only version source for all release assets.
2. Update `docs/release-notes-1.0.md`, the README, installation docs, and
   `website/index.html`. The site lives in this repository and is published
   with GitHub Pages. Keep its installation copy consistent with
   [installation](guides/installation.md).
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
**granular npm token** as `NPM_TOKEN` in repository secrets or the
`npm-production` environment. An existing repository token can be used if it
has the required package/scope access. Its settings must allow the intended CI publication, including any
applicable 2FA policy. No credentials belong in Git.

Once the packages exist, configure npm trusted publishing for all six packages:
GitHub owner `fundamental-research-labs`, repository `mog`, workflow
`publish-cli.yml`, environment `npm-production`. After verifying OIDC publication,
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
npm tarballs, and `SHA256SUMS`. Review the draft and checksums, then publish the
GitHub release. Run **Publish CLI to npm** from `main` with tag `v1.0.0`:

```sh
gh workflow run publish-cli.yml --ref main -f tag=v1.0.0
```

This separate publication step uses the existing `npm-production` protection
rules, which allow `main` and release branches rather than tag refs. It requires
a published stable GitHub release, verifies its downloaded artifacts, and
publishes platform packages before the launcher.
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
release-pending copy in the README, installation docs, and `website/index.html`
with the published install instructions. Publish the site by running the
**Website** workflow from `main` (`workflow_dispatch`). It does not run on pull
requests. The deploy waits on the `github-pages` environment, which requires
approval before the page goes live. Restrict who can start that workflow to
repository admins with an Actions execution policy on
`.github/workflows/website.yml` (actor role Admin, event `workflow_dispatch`).
npm publication stays a separate step and does not run on a branch push.

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
