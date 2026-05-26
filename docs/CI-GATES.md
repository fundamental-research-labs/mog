# CI Gates

Mog CI gates are defined in `tools/ci-gates.jsonc` and executed by
`tools/run-ci-gate.mjs`. The inventory is the readable contract; root package
scripts and GitHub workflow steps should call named gates instead of
duplicating command lists.

## Pull Request CI

List the current pull-request gate set:

```bash
pnpm check:ci:list
```

Validate that `package.json` still exposes the scripts declared by the
inventory:

```bash
pnpm check:ci:inventory
```

The `ci-pr` group currently includes formatting, TypeScript linting, Rust
check/clippy, Rust formatting, dependency cycles, TypeScript composite build,
public package boundaries, and path hygiene.

## Publish Readiness

Non-eval publish readiness is a stricter local contract around CI plus public
package consumer checks:

```bash
pnpm check:publish-readiness
```

For fast diagnosis, use the explicit narrow variants:

```bash
pnpm check:publish-readiness:list
pnpm check:publish-readiness:fast
pnpm check:publish-readiness:public
pnpm check:publish-readiness:sdk
```

`check:publish-readiness:fast` is not equivalent to the full gate. It runs the
public boundary aggregate, SDK static checks, and path hygiene only.

Eval gates remain separate from these non-eval CI/package gates. Run the
pre-publish eval workflow when release confidence depends on formula,
roundtrip, colab, API, or app-eval behavior.

## Workflow Rule

When adding or changing a CI gate:

1. Update `tools/ci-gates.jsonc`.
2. Add or update a root script only if humans or workflows need a stable entry.
3. Run `pnpm check:ci:inventory`.
4. Wire GitHub workflows to the named gate or document why the workflow step is
   publish-only and cannot share the local command.
