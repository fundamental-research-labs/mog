# iframe Embed

> **Reserved** — Mog does not currently publish a public iframe embed entrypoint or documented embed host page. Use [Embed: Web Component](embed-web-component.md) or [Embed: React](embed-react.md) for supported public embeds.

The source tree contains reserved iframe transport plumbing for a versioned postMessage protocol, but it is not exported from `@mog-sdk/embed` and should not be imported by applications.

Until a public iframe integration is released, do not rely on:

- `@mog-sdk/embed/iframe` or source-internal iframe modules
- Raw workbook URLs, bytes, provider config, storage credentials, or bearer/refresh tokens in embed config
- Cross-origin save, edit, or collaboration behavior beyond what the public same-page embed guides document

See [Security and Governance](security-and-governance.md) for trust boundary context.
