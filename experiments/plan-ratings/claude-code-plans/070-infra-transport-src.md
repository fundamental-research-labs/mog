# Plan 070 — Harden `mog/infra/transport/src`: the cross-host bridge transport layer

## Source folder and scope

- **Folder:** `mog/infra/transport/src` (package `@mog/transport`, `version 0.1.0`, private).
- **In scope:** the TypeScript transport abstraction that adapts the generated
  Rust-bridge command protocol (`@rust-bridge/client`'s `BridgeTransport`
  interface) onto three concrete hosts:
  - **WASM** (`wasm-transport.ts`, `wasm-loader.ts`) — web fallback.
  - **NAPI** (`napi-transport.ts`, `napi-loader.ts`) — Node/headless/SDK, native `.node` addon.
  - **Tauri IPC** (`tauri-transport.ts`) — desktop.
  Plus the cross-cutting middleware and contracts that sit between the client
  and the host: `factory.ts` / `factory.browser.ts` (runtime selection),
  `case-normalize.ts` (snake→camel), `bytes-tuple.ts` (binary tuple unpacking),
  `time-injection.ts` (NOW()/TODAY() serial injection), `bridge-error.ts`
  (tagged-error discriminated union), `errors.ts` (`TransportError` / `TrapError`
  / `AddonNotFoundError`), `detection.ts`, `types.ts`, the two entry points
  (`index.ts`, `index.browser.ts`), and the generated `command-metadata.gen.ts`.
- **Out of scope (but referenced):** the Rust bridge codegen that emits
  `command-metadata.gen.ts` (lives in `bridge-ts` / compute-core), the
  `@rust-bridge/client` package, kernel consumers (`compute-bridge.ts`,
  `document-lifecycle-*`), and the trap-recovery coordinator in `shell/`. These
  are dependency boundaries, not edit targets, and are called out in
  Parallelization notes.
- **Not edited by this plan:** `package.json`, `tsup.config.ts`, `tsconfig*.json`,
  `command-metadata.gen.ts` (generated), and all `__tests__`. Where the right
  production fix touches a config or the codegen, the plan states the required
  change and routes it to the owning surface rather than hand-editing the artifact.

## Current role of this folder in Mog

`@mog/transport` is the single seam through which every host runs Rust compute
and XLSX commands. The kernel builds a `BridgeTransport` once per document
(`createComputeBridge(ctx, …)` → `createTransport(config)`) and dependency-injects
it; ~13 consumer sites across kernel, shell, apps, and the SDK depend on the
package's public surface (`index.ts` / `index.browser.ts`).

A transport is a thin `{ call(command, args): Promise<T> }`. The real work is a
**composed middleware stack** built by the factory, host-dependent:

- **NAPI:** `createLazyNapiTransport` (defers engine creation to `compute_init`) →
  `createNapiTimeInjectingTransport` → `createBytesTupleNormalizingTransport`.
  Inside the lazy transport, `createNapiTransport` performs the heavy lifting:
  docId stripping, named→positional arg conversion, per-arg serde
  `JSON.stringify`, JSON-string return parsing, and `deepSnakeToCamel`.
- **WASM:** `createWasmTransport` → `createTimeInjectingTransport` →
  `createCaseNormalizingTransport`, with trap classification turning
  `WebAssembly.RuntimeError` into `TrapError` for the recovery coordinator.
- **Tauri:** `createTauriTransport` → `createBytesTupleNormalizingTransport`.

The layer absorbs four host-specific impedance mismatches so consumers see one
uniform contract: (1) **serde encoding** — NAPI `[serde]` params need JSON
strings, WASM does not; (2) **case** — Rust serde defaults to snake_case, TS
contracts are camelCase; (3) **binary tuples** — `(Vec<u8>, T)` is packed
differently per host; (4) **time** — neither WASM nor NAPI can read the wall
clock from inside Rust, so NOW()/TODAY() serials are injected before recalc in
the user's IANA calendar frame. It also owns the **error taxonomy** that lets
callers branch on `kind === 'PartialArrayWrite'` instead of substring-matching.

## Improvement objectives

1. **Make generated metadata the single authoritative source for serde
   serialization, and retire the heuristic from the production path.**
   `createNapiTransport` currently has *three* layered strategies: the generated
   `NAPI_SERDE_PARAM_INDICES` (505 commands), a hand-maintained
   `DEFAULT_NAPI_SERDE_PARAMS` (~50 commands) unioned on top, and — for any
   command absent from both — a **type-based heuristic** that the code itself
   documents as *incorrect* for primitive `[serde]` params (`Option<&str>`,
   `Option<u32>`, string enums). Wrong serde encoding is silent data corruption
   at the FFI boundary. Goal: codegen covers every command; the heuristic
   becomes a fenced, logged fallback (or hard error) rather than a routine path.

2. **Eliminate the two sources of truth for serde indices.** The hand map and
   the generated map are merged per-call in `getNapiSerdeIndices` (a fresh `Set`
   allocated on every command invocation). The hand map can silently disagree
   with — or go stale against — the generated map. Goal: fold the hand-curated
   exceptions into the codegen input so `DEFAULT_NAPI_SERDE_PARAMS` shrinks to
   zero (or to a clearly-marked, asserted "codegen-gap" residue), and precompute
   the lookup once.

3. **Remove factory duplication that invites drift.** The WASM construction
   sequence is written out **three times** (auto-detect in `factory.ts`, explicit
   `'wasm'` in `factory.ts`, and `factory.browser.ts`) and the NAPI sequence
   twice. The case-normalize step already lives in some copies and not obviously
   others — exactly the kind of divergence that produces host-specific bugs.
   Goal: extract `composeWasmTransport` / `composeNapiTransport` builders shared
   by all entry points.

4. **Close the headless time-injection timezone gap.** `createHeadlessNapiTransport`
   hardcodes `() => 'UTC'`, so any consumer still on that path gets TODAY()/NOW()
   off by up to a calendar day. Goal: thread `getUserTimezone` through it (same
   contract as the lazy path) so calendar correctness is uniform, not
   path-dependent.

5. **Make the positional-arg ordering contract explicit and verifiable.** Both
   WASM and NAPI convert named args to positional via `Object.values` /
   `Object.entries`, *relying on the generated client emitting keys in Rust
   parameter order*. This load-bearing assumption is enforced nowhere; a codegen
   change reorders args silently and corrupts every call. Goal: encode parameter
   order/arity in the generated metadata and assert it at the boundary.

6. **Restore the cross-language error-shape invariant the docs claim exists.**
   `bridge-error.ts` says a TS test pins the complete `BridgeError` variant list
   so a Rust-only variant addition fails the TS build, and points at
   `__tests__/bridge-error-shape.test.ts`. That file does not exist (the actual
   file is `bridge-error.test.ts`, which does not pin the full enum). The
   invariant is currently undefended. Goal: make the claim true.

7. **Bound the cost of the always-on `deepSnakeToCamel` safety net.** Every WASM
   and NAPI response is deep-walked and reallocated key-by-key (large reads —
   full-range / full-sheet payloads — pay an O(nodes) clone). The module comment
   names Rust-side `#[serde(rename_all = "camelCase")]` as the principled fix and
   the walk as a transitional net. Goal: drive coverage of the Rust-side
   attribute high enough to make the walk a no-op safety check, and keep the
   walker allocation-light meanwhile.

## Production-path contracts and invariants to preserve or strengthen

- **`BridgeTransport.call` shape is the public contract.** All composition is
  transparent wrapping; the signature `call<T>(command, args): Promise<T>` must
  not change. Consumers depend on it via DI.
- **Serde encoding is exact, not best-effort.** For every command, each
  positional arg is either JSON-stringified (`[serde]`) or passed through
  (`[str]`/`[parse]`/`[prim]`/`[bytes]`). This mapping must be *complete and
  authoritative* per command — strengthen from "generated ∪ hand ∪ heuristic" to
  "generated, verified complete."
- **Argument order = Rust parameter order** after `docId` stripping. Preserve;
  add a runtime/codegen assertion (objective 5).
- **`docId` stripping** for NAPI (engine instance *is* the document) and **`docId`
  passthrough** for Tauri (registry lookup) must remain host-correct.
- **Lifecycle interception** must keep NAPI behaving like WASM/Tauri:
  `compute_init` (and `compute_init_from_yrs_state`) create the engine lazily;
  `compute_destroy` tears it down; calls before init throw a clear error. Don't
  regress the collaboration `initFromYrsState` join path.
- **Trap classification is a recovery-critical signal.** `TrapError` must remain
  a `TransportError` subclass with `isTrap === true`, raised *only* on
  `instanceof WebAssembly.RuntimeError` **and** an exact known-trap message —
  over-classification triggers spurious recovery cycles. Preserve the narrow set;
  any expansion must be evidence-backed per runtime.
- **`resetWasmModule` must clear both caches** (this module's reference *and*
  wasm-bindgen's private slots via `__wbindgen_reset`); a fresh
  `WebAssembly.Instance` depends on it. Do not weaken.
- **Time serial space parity:** injected NOW()/TODAY() serials must share the
  Excel-epoch + 1900-leap-bug serial space used by cell values
  (`spreadsheet-utils` `dateToSerial`), computed in the user's IANA frame. Keep
  the epoch/cutoff constants in lockstep.
- **Bytes-tuple wire formats:** WASM `[Uint8Array, T]` passthrough; Tauri/NAPI
  `[u32 LE len][bytes][JSON meta]` unpack. Length read is little-endian; keep it.
- **Bridge-error sentinel `[BRIDGE_ERROR]{json}` is byte-identical across hosts**
  and parsed by walking the ES2022 `cause` chain. Preserve; the variant union
  must stay synced with Rust (objective 6).
- **Browser bundle must not pull Node-only code.** `index.browser.ts` /
  `factory.browser.ts` must never statically import `napi-loader`,
  `napi-transport`, or `node:*`. Any refactor (objective 3) must keep the shared
  builders host-split so bundlers never see native imports in the browser graph.
- **Loaders are idempotent singletons** (`loadWasmModule`, `tryLoadNapiAddon`).
  Preserve idempotency and the graceful WASM fallback when the NAPI addon is
  absent (Jest, unbuilt binary).

## Concrete implementation plan

### Phase A — Serde single-source-of-truth (objectives 1, 2) — highest value

1. **Audit codegen coverage.** Diff `DEFAULT_NAPI_SERDE_PARAMS` (in
   `napi-transport.ts`) against generated `NAPI_SERDE_PARAM_INDICES`. For each
   hand-map command, classify: (a) identical to generated (delete from hand map);
   (b) hand map is a superset (codegen gap — fix codegen input); (c) genuine
   conflict (investigate — likely a stale hand entry or a serde annotation the
   codegen missed). Produce the classification table in the PR description.
2. **Fix the codegen input, not the artifact.** For every (b)/(c) command, add
   the missing `[serde]` annotation / metadata hint in the Rust bridge so
   `pnpm generate:bridge` emits the correct indices. This is the production fix —
   it removes the hand map's reason to exist. (Coordinated with the bridge-ts /
   compute-core owner; see Parallelization.)
3. **Reduce `DEFAULT_NAPI_SERDE_PARAMS` to empty** (or to a tiny, loudly-commented
   "known codegen gap" residue with a tracking note). Update `createNapiTransport`
   /`createLazyNapiTransport` call sites accordingly.
4. **Precompute the merged lookup once.** Replace per-call `getNapiSerdeIndices`
   `Set` allocation with a module-load-time `Map<string, Set<number>>` (or, if
   the hand map is gone, read `NAPI_SERDE_PARAM_INDICES` directly as
   `Set`-converted once).
5. **Demote the heuristic to a fenced fallback.** When a command is absent from
   the generated metadata:
   - In **development/test**, throw a `TransportError` naming the command
     ("not in generated serde metadata — regenerate bridge codegen"), so a new
     command without metadata fails loudly instead of silently mis-encoding.
   - In **production**, keep the existing type-based heuristic but emit a
     one-time `console.warn`/diagnostic so the gap is observable, never silent.
   The name-based `NAPI_SERDE_STRING_PARAMS` shortcut (`sheetId`/`cellId`) becomes
   redundant once codegen is authoritative — fold it into the codegen and remove.

### Phase B — Factory de-duplication (objective 3)

6. Add `composeNapiTransport(addon, getUserTimezone)` and
   `composeWasmTransport(getModule, getUserTimezone)` helpers (new internal
   module, e.g. `compose.ts`, or co-located in `factory.ts`) that encapsulate the
   exact middleware stack order. The WASM helper is browser-safe (no Node
   imports) so `factory.browser.ts` reuses it; the NAPI helper lives behind the
   Node-only import boundary.
7. Rewrite `factory.ts` (auto-detect + all three `explicitRuntime` cases) and
   `factory.browser.ts` to call the helpers. This collapses three WASM copies to
   one and two NAPI copies to one, eliminating drift risk and pinning a single
   canonical stack order.
8. Add a unit test asserting both factories produce structurally identical WASM
   stacks (e.g. via spy ordering) so the dedup can't silently re-diverge.

### Phase C — Headless timezone correctness (objective 4)

9. Change `createHeadlessNapiTransport(engine, addon)` to
   `createHeadlessNapiTransport(engine, addon, getUserTimezone = () => 'UTC')`
   and pass it into the inner `createNapiTimeInjectingTransport` instead of the
   hardcoded `() => 'UTC'`. Default preserves current behavior; callers on a
   workbook session can now supply the real resolver. Update the doc comment to
   stop describing the path as TZ-incorrect.

### Phase D — Positional-arg ordering guard (objective 5)

10. Extend the bridge codegen to emit, per command, the ordered parameter-name
    list (e.g. `NAPI_PARAM_ORDER: Record<string, string[]>`). At the NAPI/WASM
    boundary, assert in dev/test that `Object.keys(rest)` equals the expected
    order (after docId strip). A mismatch throws with a precise message instead
    of silently shifting every positional arg. In production this assertion is
    compiled out / behind the dev flag to avoid per-call overhead.

### Phase E — Error-shape invariant (objective 6)

11. Add the missing TS coverage test (name it to match the doc, or fix the doc to
    point at the real file — pick one and make them consistent). The test must
    enumerate every `BridgeErrorKind` and fail if the Rust enum gains a variant
    not mirrored here — ideally by importing a generated `BRIDGE_ERROR_KINDS`
    list (emit it from the same codegen that pins the Rust side via
    `compute_error_every_variant_has_kind_field`). This converts the doc's
    aspirational claim into an enforced gate. (Test-side, but it defends a
    production contract; the production change is the codegen emit.)

### Phase F — Case-normalization cost (objective 7)

12. Measure (in a profiling spike, not a committed bench) the `deepSnakeToCamel`
    cost on the largest real responses (full-sheet read, large range, XLSX
    parse metadata). Drive the Rust-side `#[serde(rename_all = "camelCase")]`
    coverage so the walk finds nothing to rename on the hot reads. Keep the
    walker as a safety net but make it allocation-light: when a subtree's keys
    are already camelCase, return it without rebuilding (skip the per-node object
    clone). Binary-payload passthrough stays as-is.

### Sequencing within the folder

Phase A first (it's the correctness centerpiece and the largest hand-written
risk). B and C are independent and can land in parallel. D and E depend on
codegen extensions and can ride alongside A's codegen work. F is a measurement-led
follow-up; do not change the walker without the profiling spike justifying it.

## Tests and verification gates

> The execution constraints for this planning task forbid running build/test/
> typecheck commands here. The gates below are the required CI verification for
> the implementing PR(s).

- **Serde correctness (Phase A):** extend `napi-transport-serde.test.ts` with a
  table-driven case per representative `[serde]` shape — `Option<&str>`,
  `Option<u32>`, string enum (`CommentType`), transparent UUID wrapper
  (`PolicyId`), `Vec<T>`, nested struct, `[bytes]` passthrough — asserting the
  exact stringified vs. passthrough decision. Add a property-style check that
  every command in `NAPI_SERDE_PARAM_INDICES` round-trips through a stub engine
  without throwing the new "missing metadata" guard.
- **Heuristic fence:** test that an unknown command throws in test mode and
  warns (not throws) in production mode.
- **Factory parity (Phase B):** new test asserting `factory.ts` and
  `factory.browser.ts` build identical WASM middleware order; existing
  `lazy-napi-transport.test.ts` continues to pass (lifecycle interception
  unchanged).
- **Timezone (Phase C):** extend `time-injection.test.ts` to assert
  `createHeadlessNapiTransport` injects a serial computed in the supplied TZ
  (e.g. a fixed instant in `America/Los_Angeles` vs `UTC` yields the expected
  calendar-day difference at a day boundary).
- **Arg-order guard (Phase D):** test that a deliberately reordered args object
  trips the dev assertion.
- **Error-shape (Phase E):** the new enumeration test must fail when a synthetic
  extra Rust kind is present and absent from the TS union (simulate via the
  generated kinds list).
- **Trap classification regression:** `synthetic-trap.test.ts` and
  `trap-error.test.ts` must stay green — the narrow trap set is unchanged.
- **WASM reset:** `wasm-loader-reset.test.ts` green — both caches still cleared.
- **Repo gates:** `pnpm --filter @mog/transport typecheck`,
  `pnpm --filter @mog/transport test`, and `pnpm --filter @mog/transport build`
  (tsup dual browser/node bundles). Plus a downstream typecheck of kernel/shell/
  apps that import `@mog/transport`, since the package has no published types
  boundary isolating consumers.
- **Codegen regen gate:** `pnpm generate:bridge` must be re-run and its output
  (`command-metadata.gen.ts`) committed; CI should fail if the generated file is
  stale relative to the Rust annotations (existing codegen-drift check, if any —
  otherwise add one).
- **Bundle-purity check:** assert the built `dist/index.browser.js` contains no
  `node:`/`createRequire`/napi-loader references (guards objective 3's refactor).

## Risks, edge cases, and non-goals

**Risks / edge cases**
- **Serde reclassification can break live commands.** Folding the hand map into
  codegen risks a command whose Rust annotation doesn't actually match the hand
  map's belief. Mitigation: the Phase A audit table makes every change explicit;
  keep the (b)/(c) residue behind an asserted fallback until each is confirmed by
  an integration test against a real engine.
- **Stale NAPI binary.** `deepSnakeToCamel` is partly a shim for binaries built
  before `rename_all = "camelCase"`. Reducing the walk (Phase F) must not break
  consumers running an older `.node`. Keep the net; only optimize the no-rename
  path.
- **Trap message set drift across V8/SpiderMonkey versions.** Out of scope to
  expand here without per-runtime evidence; expanding it risks spurious recovery.
- **`new Function('import(...)')` escape hatch** in `wasm-loader` defeats bundler
  static analysis deliberately (Node WASM init via local bytes). Don't "clean it
  up" into a static import — that re-breaks the undici `fetch(file://)` path.
- **`Object.entries`/`Object.values` ordering** is spec-guaranteed for string
  keys in insertion order, but the *insertion* order is the codegen's
  responsibility — Phase D's guard is the real protection.
- **Config drift noted but routed, not edited here:** `tsup.config.ts` externals
  list the `linux-*-musl` platform packages but omit `linux-x64-gnu` /
  `linux-arm64-gnu` that `napi-loader.ts` resolves; and `@mog/compute-core-napi`
  remains in `optionalDependencies` + externals though no source imports it
  (loading is via `createRequire` of published platform packages only). Because
  platform packages are runtime-`require`d (never statically imported), the
  externals mismatch is low-impact today, but the inconsistency should be
  reconciled by the package owner. Flag for follow-up; do not hand-edit config
  in the transport change.

**Non-goals**
- No change to the `BridgeTransport` public signature or the command protocol.
- No new host backend.
- No rewrite of `@rust-bridge/client` codegen beyond the additive metadata emits
  (serde gaps, param order, error-kind list) named above.
- No test-only patch substituting for the real codegen fix — the hand map must
  be retired at its source, not papered over.
- No behavioral change to trap detection beyond keeping it correct.

## Parallelization notes and dependencies on other folders

- **Hard dependency on the bridge codegen (`bridge-ts` / compute-core
  `#[bridge::api]` annotations).** Objectives 1, 2, 5, and 6 require additive
  emits into `command-metadata.gen.ts` (`NAPI_PARAM_ORDER`, `BRIDGE_ERROR_KINDS`)
  and corrected `[serde]` annotations. This must be coordinated with the folder
  that owns that codegen; the transport-side changes (consuming the new metadata)
  can be staged behind it. Recommend landing codegen emits first, then the
  transport consumption.
- **`@rust-bridge/client`** — supplies `BridgeTransport` and the named-args
  objects whose key order Phase D pins. No edits required, but the param-order
  guarantee is jointly owned with that package.
- **Downstream consumers** (`kernel/src/bridges/compute/*`,
  `document-lifecycle-*`, `shell/src/services/trap-recovery/*`, `apps/spreadsheet`,
  `runtime/sdk`) consume the public surface. Phases A–C are behavior-preserving
  by construction (defaults unchanged), so no consumer edits are required; the
  Phase C TZ improvement is opt-in via the new `getUserTimezone` argument and
  should be wired through `createComputeBridge` in a follow-up kernel change.
- **Within this folder, parallelizable:** Phase B (factory dedup) and Phase C
  (headless TZ) are independent of Phase A and of each other. Phase E (error
  test) is independent once the codegen emits the kinds list. Phase A is the
  critical path and should not be parallelized against itself — the audit must
  precede the deletions.

---

### Appendix — evidence anchors (read-only inspection)

- Three serde strategies layered: `napi-transport.ts:39-129` (hand map),
  `:159-167` (`getNapiSerdeIndices` per-call `Set` union),
  `:240-278` (heuristic with self-documented incorrectness at `:273-277`).
- Generated authority: `command-metadata.gen.ts:282` (`NAPI_SERDE_PARAM_INDICES`,
  505 entries), `:7` (`BYTES_TUPLE_COMMANDS`), `:791` (`RECALC_COMMANDS`),
  `:1044` (`BRIDGE_COMMAND_SECURITY_LEVELS`); header: "DO NOT EDIT — generated".
- Factory duplication: `factory.ts:68-77` (explicit wasm) vs `:101-115`
  (auto-detect wasm) vs `factory.browser.ts:43-55`.
- Headless TZ hardcode: `napi-transport.ts:361` (`() => 'UTC'`) with the
  doc-comment acknowledgement at `:355-360`.
- Positional-order reliance: `napi-transport.ts:236-237`,
  `wasm-transport.ts:91` (`Object.values(args)`).
- Error-shape invariant claim vs. reality: `bridge-error.ts:19-27` references
  `__tests__/bridge-error-shape.test.ts`; actual file is
  `__tests__/bridge-error.test.ts`, which does not pin the full variant union.
- Always-on deep walk: `case-normalize.ts:113-120`,
  `napi-transport.ts:286-296`.
