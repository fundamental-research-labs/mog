# iframe Embed

> **Status: reserved**

Mog does not currently publish a public iframe embed entrypoint, child bundle, or documented iframe host page. There is no copy-paste iframe setup to use from npm today.

Use [Embed: Web Component](embed-web-component.md) or [Embed: React](embed-react.md) for shipped public same-page embeds. Those surfaces run in the host page's origin and use a host-owned `MogEmbedHostPolicy` to resolve authorized workbook bytes and effective state.

## Current Package Boundary

`@mog-sdk/embed` is shipped, and its root, `./react`, `./web-component`, and `./config` entrypoints are public-experimental. The iframe transport is different:

- `@mog-sdk/embed/iframe` is reserved and is not in `runtime/embed/package.json` `exports`.
- `runtime/embed/tsup.config.ts` does not emit an iframe bundle.
- `runtime/embed/EXPOSURE.md` classifies `./iframe` as source-internal reserved plumbing.
- Package-boundary tests assert that `./iframe`, `./client`, `./full-app`, and `./publish` are not package exports.

Source files under `runtime/embed/src/iframe/` and related iframe host-adapter files exist for protocol evaluation and tests. They define a versioned `postMessage` envelope, exact-origin validation, parent/child handles, and save/export request messages, but they are not a supported public integration contract.

## Do Not Rely On

Until a public iframe integration is released, applications should not rely on:

- `@mog-sdk/embed/iframe`, `@mog-sdk/embed/host-adapters/*`, or source-internal iframe modules.
- A CDN iframe page, child runtime URL, or browser asset layout for iframe embedding.
- Raw workbook URLs, inline workbook bytes, provider config, storage credentials, bearer tokens, or refresh tokens in public embed config.
- Cross-origin save, edit, export, navigation, or collaboration behavior beyond what the public same-page embed guides document.

See [Security and Governance](security-and-governance.md) for trust boundary context.
