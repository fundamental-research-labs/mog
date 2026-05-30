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

Non-eval publish readiness is the release-facing package gate. It combines
format and public-boundary checks with public artifact, naming, declaration,
API snapshot, binary-wrapper, and external fixture checks:

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

Eval workflows are not part of these non-eval CI/package gates. Run them
separately when release confidence depends on formula, roundtrip,
collaboration, API, or app behavior.

## Workflow Rule

When adding or changing a CI gate:

1. Add or update a root script with a stable name.
2. Keep the command list scoped to files and packages present in this repo.
3. Wire GitHub workflows to the named gate or document why the workflow step is
   publish-only and cannot share the local command.
