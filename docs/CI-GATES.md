# CI Gates

Mog CI gates are exposed as root `package.json` scripts. The public repository
is maintained directly; it is not generated from a projection step.

## Pull Request CI

Run the local pull-request checks:

```bash
pnpm check:ci:format
pnpm check:ci:lint
pnpm check:ci:typecheck
pnpm check:ci:public-boundaries
```

## Publish Readiness

Non-eval publish readiness is a stricter local contract around CI plus public
package consumer checks:

```bash
pnpm check:publish-readiness
```

For fast diagnosis, use the explicit narrow variants:

```bash
pnpm check:publish-readiness:fast
pnpm check:publish-readiness:public
pnpm check:publish-readiness:sdk
```

`check:publish-readiness:fast` is not equivalent to the full gate. It runs the
public boundary aggregate and release naming checks only.

Eval gates remain separate from these non-eval CI/package gates. Run the
pre-publish eval workflow when release confidence depends on formula,
roundtrip, colab, API, or app-eval behavior.

## Workflow Rule

When adding or changing a CI gate:

1. Add or update a root script with a stable name.
2. Keep the command list scoped to files and packages present in this repo.
3. Wire GitHub workflows to the named gate or document why the workflow step is
   publish-only and cannot share the local command.
