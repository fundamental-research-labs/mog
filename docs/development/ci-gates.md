# CI Gates

Mog's local CI gates are root `package.json` scripts. The public repository is
maintained directly; it is not generated from a projection step.

Run these commands from the repository root after installing dependencies.

## Local Pull Request Checks

The public repo currently exposes pull-request checks as local scripts. A
separate PR GitHub Actions workflow is not checked in.

```bash
pnpm check:ci:format
pnpm check:ci:lint
pnpm check:ci:typecheck
pnpm check:ci:public-boundaries
```

Those scripts expand as follows:

| Script | Current root command |
| --- | --- |
| `check:ci:format` | `pnpm format:check` |
| `check:ci:lint` | `pnpm lint` |
| `check:ci:typecheck` | `pnpm typecheck` |
| `check:ci:public-boundaries` | `pnpm validate:packages && pnpm check:private-leaks && pnpm lint:boundaries && pnpm check:platform-dependencies && pnpm check-cycles && pnpm check:host-surface-disposition` |

`pnpm lint` is currently the import-boundary lint aggregate. Broader package
tests are available through `pnpm test`, but they are not part of the
`check:ci:*` root aggregate.

`pnpm check:private-leaks` scans committed public-repo text and fixture paths
for local absolute paths, private sibling repo names, private workbook
provenance, and corpus-derived reducer handles. Exact sensitive identifiers
should not be committed to this repo; supply them through an untracked
newline-delimited regex file via `MOG_PRIVATE_LEAK_PATTERNS` when a local or CI
environment has access to that private list.

## Publish Readiness

Non-eval publish readiness is the release-facing package gate:

```bash
pnpm check:publish-readiness
```

The full local gate runs format checks, public-boundary checks, public artifact
build/verification, release naming checks, binary-wrapper surface checks,
contracts declaration identity checks, declaration rollup checks, API snapshot
checks, and packed external fixture checks with `--skip-build`.

For faster diagnosis, use the explicit narrow variants:

```bash
pnpm check:publish-readiness:fast
pnpm check:publish-readiness:public
pnpm check:publish-readiness:sdk
```

These variants are intentionally narrower than the full gate:

| Script | Current root command |
| --- | --- |
| `check:publish-readiness:fast` | `pnpm check:ci:public-boundaries && pnpm check:release-readiness-naming` |
| `check:publish-readiness:public` | `pnpm check:ci:public-boundaries` |
| `check:publish-readiness:sdk` | `pnpm check:declaration-rollups && pnpm check:api-snapshots && pnpm check:external-fixtures -- --skip-build` |

Eval workflows are not part of these non-eval CI/package gates. Run them
separately when release confidence depends on formula, roundtrip,
collaboration, API, or app behavior.

## GitHub Publish Workflow

The checked-in GitHub Actions workflow is
`.github/workflows/publish-sdk.yml`. It is a manual `workflow_dispatch` release
workflow, not the local PR gate. It validates release branch and package
versions, checks whether target npm packages already exist, builds native and
WASM artifacts, then runs publish-readiness steps against release candidates.

The publish workflow does not call `pnpm check:publish-readiness` verbatim. It
runs the relevant component commands directly because the workflow has
matrix-built native/WASM artifacts and package-assembly/tarball steps that are
publish-only:

```bash
pnpm validate:packages
pnpm check:private-leaks
pnpm run build:public-artifacts -- --skip-native-build --skip-wasm-build
pnpm check:binary-wrapper-surfaces
pnpm check:contracts-declaration-identity
pnpm check:declaration-rollups
pnpm check:api-snapshots
pnpm assemble:public-packages
pnpm check:public-package-manifests
pnpm check:external-fixtures -- --skip-build
```

## Workflow Rule

When adding or changing a CI gate:

1. Add or update a root script with a stable name.
2. Keep the command list scoped to files and packages present in this repo.
3. Wire GitHub workflows to the named gate, or document why a publish-only
   workflow step cannot share the local command.
