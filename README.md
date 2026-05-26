# Mog

Mog is a spreadsheet engine, app runtime, and SDK stack for building
workbook-aware agents, automations, and embedded spreadsheet experiences.

## Choose Your Path

| I want to... | Start here | Useful command |
| --- | --- | --- |
| Run the Mog spreadsheet app | [Run the app](#run-the-app) | `pnpm dev` |
| Use Mog in my agent or app | [Use Mog as a library](#use-mog-as-a-library) | `pnpm add @mog-sdk/node` |
| Contribute or navigate the repo | [Develop Mog](#develop-mog) | `pnpm check:ci:list` |

## Run The App

Prerequisites: Node.js, pnpm, Rust, and `wasm-pack`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs the spreadsheet development app (`@mog/spreadsheet-dev`) with
Vite. The default local URL is `http://localhost:3002`.

For the explicit package command:

```bash
pnpm --filter @mog/spreadsheet-dev dev
```

## Use Mog As A Library

Use `@mog-sdk/node` for headless workbook automation in Node.js and agent
workflows.

```bash
pnpm add @mog-sdk/node
```

```ts
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', '=A1*2');

console.log(await ws.getCell('A2'));
await wb.dispose();
```

Use `@mog-sdk/embed` for browser, React, and Web Component embeds. See:

- [Node SDK](runtime/sdk/README.md)
- [React embed](docs/guides/embed-react.md)
- [Web Component embed](docs/guides/embed-web-component.md)
- [Full spreadsheet app embed](docs/guides/spreadsheet-app-embed.md)

## Develop Mog

This is a large monorepo. Start with the package or surface you are changing,
then run the smallest relevant verification gate.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
cargo check -p compute-core --lib --locked
cargo test -p compute-core --locked
```

Common package checks:

```bash
pnpm check:ci:list
pnpm check:ci:inventory
pnpm --filter @mog-sdk/node test
pnpm --filter @mog-sdk/embed test
pnpm --filter @mog-sdk/sheet-view test
pnpm check:external-fixtures
```

CI and non-eval publish readiness gates are documented in
[CI Gates](docs/CI-GATES.md).

If you are a coding agent, read [AGENTS.md](AGENTS.md) before editing code.

## Repository Map

| Area | Paths |
| --- | --- |
| Spreadsheet app | `runtime/spreadsheet-app`, `apps/spreadsheet`, `shell` |
| Node SDK | `runtime/sdk` |
| Embeds | `runtime/embed`, `views/sheet-view` |
| Rust compute engine | `compute/core` |
| Public TypeScript contracts | `contracts` |
| Kernel and services | `kernel` |
| External consumer fixtures | `fixtures/external` |
| Architecture docs | `docs` |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [CI gates](docs/CI-GATES.md)
- [TypeScript package boundaries](docs/TYPESCRIPT-PACKAGE-BOUNDARIES.md)
- [Trademark notices](TRADEMARKS.md)

## License

MIT. See [LICENSE](LICENSE).
