# Mog

Mog is a spreadsheet engine, app runtime, and SDK stack for building
workbook-aware agents, automations, and embedded spreadsheet experiences.

Try it live at [mog.shortcut.ai](https://mog.shortcut.ai/).

## Choose Your Path

| I want to... | Start here | Useful command |
| --- | --- | --- |
| Build Mog from source | [Develop Mog](#develop-mog) | `pnpm typecheck` |
| Use Mog in my agent or app | [Use Mog as a library](#use-mog-as-a-library) | `pnpm add @mog-sdk/sdk` |
| Contribute or navigate the repo | [Develop Mog](#develop-mog) | `pnpm check:publish-readiness:fast` |

## Use Mog As A Library

Use `@mog-sdk/sdk` for headless workbook automation in Node.js and agent
workflows. Import `@mog-sdk/sdk/node` when a consumer needs to force the native
Node entry.

```bash
pnpm add @mog-sdk/sdk
```

```ts
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', '=A1*2');

console.log(await ws.getCell('A2'));
await wb.dispose();
```

Agents should discover the SDK surface through `api.describe(...)`, then run
generated code through `api.guidance.analyze(source)` or
`api.guidance.preflight(source)` when that API is available in the SDK version
they are using. OfficeJS-looking code such as `Excel.run`, `Office.context`,
`context.sync()`, proxy `.load(...)`, or `range.values = ...` is diagnosed as a
foreign spreadsheet dialect; Mog does not support or shim it. In generated
sandbox code, use the injected `wb` object, derive `const ws = wb.activeSheet`,
and read `diagnostic.mogReplacements` for replacement paths/snippets.

Use `@mog-sdk/embed` for browser, React, and Web Component embeds. See:

- [Unified SDK](runtime/sdk/README.md)
- [React embed](docs/guides/embed-react.md)
- [Web Component embed](docs/guides/embed-web-component.md)
- [Full spreadsheet app embed](docs/guides/spreadsheet-app-embed.md)

## Develop Mog

This is a large monorepo. Start with the package or surface you are changing,
then run the smallest relevant verification gate.

Use `dev-v0.7.2` as the exclusive development branch for this repo unless a
task explicitly names another branch. Do not base new local work on `dev`.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
cargo check -p compute-core --lib --locked
cargo test -p compute-core --locked
```

Common package checks:

```bash
pnpm --filter @mog-sdk/sdk test
pnpm --filter @mog-sdk/embed test
pnpm --filter @mog-sdk/sheet-view test
pnpm check:publish-readiness:fast
pnpm check:external-fixtures
```

CI and non-eval publish readiness gates are documented in
[CI Gates](docs/development/ci-gates.md).

If you are a coding agent, read [AGENTS.md](AGENTS.md) before editing code.

## Repository Map

| Area | Paths |
| --- | --- |
| Spreadsheet app | `runtime/spreadsheet-app`, `apps/spreadsheet`, `shell` |
| Unified SDK | `runtime/sdk` |
| Embeds | `runtime/embed`, `views/sheet-view` |
| Rust compute engine | `compute/core` |
| Public TypeScript contracts | `contracts` |
| Kernel and services | `kernel` |
| External consumer fixtures | `fixtures/external` |
| Architecture docs | `docs` |

## Docs

- [Architecture](docs/architecture/README.md)
- [CI gates](docs/development/ci-gates.md)
- [TypeScript package boundaries](docs/architecture/typescript-package-boundaries.md)
- [Trademark notices](TRADEMARKS.md)

## License

MIT. See [LICENSE](LICENSE).
