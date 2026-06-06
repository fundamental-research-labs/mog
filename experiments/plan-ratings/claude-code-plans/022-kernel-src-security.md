# Plan 022 — Kernel Security: Capability & Protection Enforcement

## Source folder and scope

- **Folder:** `mog/kernel/src/security`
- **Files in scope (concrete impls):**
  - `capability-subject.ts` — `CapabilitySubject` model + matching helpers (`subjectMatches`, `isNarrowedBy`, `subjectSpecificity`, `subjectsEqual`, `subjectKey`, `createCapabilitySubject`)
  - `capability-registry.ts` — `CapabilityRegistryService` (metadata, namespace ownership, implied resolution, `CORE_CAPABILITIES`)
  - `grant-service.ts` — `CapabilityGrantService` (grant/revoke/check/list)
  - `trust-policy.ts` — `TrustPolicyService` (origin-based trust → grant policy)
  - `legacy-adapter.ts` — `LegacyGrantServiceAdapter` (bare `AppId` shim)
  - `index.ts` — public barrel for `@mog-sdk/kernel/security`
  - `__tests__/*` — unit tests for the four services
- **Adjacent folders referenced (not edited by this plan unless stated):**
  - `mog/kernel/src/services/capabilities/*` — the **currently-active** AppId-based capability system
  - `mog/types/app-platform/src/{capabilities,trust,plugin}/types.ts` — the **canonical contracts**

## Current role of this folder in Mog

Nominally this folder is the kernel-side capability and protection enforcement layer, surfaced as the `@mog-sdk/kernel/security` subpath (declared in `mog/kernel/package.json` `exports["./security"]`).

**The reality, established by reading the code, is a three-layer divergence:**

1. **Canonical contracts** — `mog/types/app-platform/src/capabilities/types.ts` and `trust/types.ts` define the intended interfaces: a branded `CapabilitySubject` (`PackageId`/`AppId`/`AppInstanceId`/`CapabilityId`), `ICapabilityGrantService` (`grant` returns `void`, `hasGrant`, `revoke`), `ITrustPolicyService.evaluateTrust(packageId, source)` returning a `TrustPolicyDecision` with a single `canAutoGrant: boolean` and a required `trustSource`, and `CapabilityGrant.timestamp` as an ISO-8601 string.

2. **Active runtime** — `mog/kernel/src/services/capabilities/*` (AppId-keyed grants in `grants.ts`, plus `registry.ts`, `requester.ts`, `sensitive-handler.ts`, `re-auth.ts`, `audit-logger.ts`, `taxonomy.ts`, `scope.ts`, `stores/`). **This is what `security/index.ts` actually re-exports**, and what production consumes — `mog/shell/src/app-launcher/launch-app.ts`, `capability-context.tsx`, settings UI, etc. all import `@mog-sdk/kernel/security` and receive the AppId-based system.

3. **Orphaned subject-based v2 (the files physically in this folder)** — `capability-subject.ts`, `grant-service.ts`, `capability-registry.ts`, `trust-policy.ts`, `legacy-adapter.ts`. A repo-wide symbol search shows **no production importer** of `CapabilitySubject`, `CapabilityGrantService`, `CapabilityRegistryService`, `TrustPolicyService`, or `LegacyGrantServiceAdapter` from these files — only their own `__tests__`. `index.ts` does **not** export any of them. They are effectively dead code that was written as the "next" enforcement model but never wired in.

So the folder simultaneously (a) ships an unwired, untrusted, contract-divergent enforcement implementation and (b) re-exports a different, older AppId-based system as the live one. This is the central problem the plan resolves. Because this is an authorization boundary, the divergence is a correctness/security concern, not just tidiness: the model that is reviewed and tested is not the model that enforces, and the model that enforces (AppId-only) cannot express instance/workspace/tenant/resource scoping.

## Improvement objectives

1. **Make the subject-based model the single production enforcement path** and conform it exactly to the `@mog-sdk/app-platform` contracts, eliminating the AppId-only grant keying as the authorization primitive.
2. **Fix authorization-soundness bugs** in `grant-service.ts` (deny/most-specific precedence, revoke-by-match, implied-grant scope/expiry propagation, missing registry+trust validation on `grant`).
3. **Enforce scope** end-to-end: validate grant scope against the registry `scopeSchema` and match query scope against grant scope on `check`.
4. **Harden trust policy**: never unconditionally auto-grant `critical`/restricted capabilities to first-party, authenticate the `bundled` signal, apply restriction lists to all sources.
5. **Establish authoritative namespace ownership** in the registry (reserved namespaces, no first-come squatting, no bypass for short IDs).
6. **Retire the `legacy-adapter` shim** by migrating its (currently single, documented) call sites to subjects — not by keeping the shim.
7. **Wire and export** the reconciled services through `index.ts` and the kernel package `exports`, with the active `services/capabilities` consumers migrated onto it.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (must not regress):**
- The `@mog-sdk/kernel/security` subpath remains the public entry; types currently exported (`CapabilityInfo`, `CapabilityType`, `AppId`, `CapabilityScope`, registry/audit interfaces) must keep resolving for existing consumers (`launch-app.ts`, settings UI, `capability-context.tsx`) throughout migration.
- `index.ts` must keep **not** exporting store implementations, requesters, sensitive handlers, re-auth providers, or audit-logger impls (the documented "types + pure helpers only" boundary). New service factories live behind `@mog-sdk/app-platform`, matching the existing note in the barrel header.
- Capability registrations stay immutable/append-only once registered.
- `CORE_CAPABILITIES` risk tiers and `implies` edges (`network:unrestricted ⊃ network:fetch`, `clipboard:write ⊃ clipboard:read`) are preserved as the platform baseline.

**Strengthen (new/clarified invariants):**
- **Contract conformance:** `CapabilitySubject`, `CapabilityGrant`, `TrustPolicyDecision`, `ITrustPolicyService`, `ICapabilityGrantService` in this folder must be structurally identical to (ideally re-exported from) `@mog-sdk/app-platform` contracts — branded ID types, ISO-8601 grant timestamps, `grant` semantics, `evaluateTrust(packageId, source)` signature, single `canAutoGrant` boolean.
- **Deny precedence + most-specific-wins:** when multiple grants match a query, a `denied`/`revoked` grant wins over an allow at the same-or-broader specificity, and among allows the most-specific subject's scope governs. `check` must be order-independent (no reliance on `Map` iteration order).
- **Revocation completeness:** revoking a capability for a subject must remove/override every grant whose subject covers that query (not only the exact-key entry), so revocation cannot be defeated by a broader surviving grant.
- **Scope soundness:** an implied capability is never granted with broader scope than the implying grant; a `check` with a requested scope only returns `granted` if the grant's scope covers it (reuse/align with `services/capabilities/scope.ts::scopeMatches`).
- **No auto-grant of critical/restricted without explicit policy:** first-party defaults must not silently auto-grant `riskTier: 'critical'` or any `restrictedCapabilities` entry.
- **Namespace authority:** the `mog`/`mog:*` namespace is registrable only by `@mog/*` owner packages; non-namespaced (short) IDs do not bypass ownership checks.

## Concrete implementation plan

### Phase 0 — Decision record & contract alignment (blocking gate)
- Author a short internal design note (in `mog-internal`) recording the chosen target: subject-based model conformed to `app-platform` contracts is canonical; AppId-keying becomes an internal detail of a `createCapabilitySubject({ appId })` adapter at the boundary, not the storage key.
- Resolve the field-level contract diffs explicitly:
  - `CapabilityGrant.timestamp: string` (ISO-8601) vs current `grantedAt: number` — adopt contract; keep `expiresAt` as an additive optional field and propose it as a contract addition (coordinate with the app-platform types owner; see Dependencies).
  - `ICapabilityGrantService.grant` returns `void` (contract) vs current returns `CapabilityGrant` — adopt contract `void`; expose grant readback via `listGrants`/a `getGrant` query if needed.
  - `TrustPolicyDecision` shape: contract uses single `canAutoGrant` + required `trustSource`; current uses `autoGrantList/requireConsentList/denyList`. The list form is strictly more expressive and is what real consent flows need — propose evolving the **contract** to the list form rather than dumbing the impl down (this is a production-path improvement, not a shim). Record the contract-change request.
  - `ITrustPolicyService.evaluateTrust(packageId, source)` vs current `evaluateTrust(installRecord)` — converge on a single signature carrying enough provenance to authenticate `bundled`/`signature`/`enterprisePolicyId`.

### Phase 1 — `capability-subject.ts`: adopt branded types
- Re-export or re-declare `CapabilitySubject` using the branded `PackageId`/`AppId`/`AppInstanceId` types from `@mog-sdk/app-platform` so the kernel and contracts cannot drift again.
- Keep the pure helpers (`subjectMatches`, `isNarrowedBy`, `subjectSpecificity`, `subjectsEqual`, `subjectKey`, `createCapabilitySubject`) — they are correct and reusable; ensure `subjectKey` ordering stays deterministic (it does) and add it as the canonical Map key.

### Phase 2 — `grant-service.ts`: fix the authorization core
- **Deterministic resolution:** replace `findMatchingGrant` (returns first iteration match) with a function that collects *all* matching grants, then applies precedence: (1) any matching `denied`/`revoked` grant at ≥ query specificity ⇒ deny; (2) otherwise pick the most-specific (`subjectSpecificity`) live allow; ties broken deterministically (e.g., by `subjectKey`).
- **Revoke by match, with tombstones:** `revoke(subject, cap)` must (a) delete exact-key grants and (b) write a `revoked` tombstone covering the subject so a surviving broader allow cannot re-authorize; `check` honors tombstones via the deny-precedence rule. This makes the existing-but-currently-unreachable `'revoked'` branch in `check` live.
- **Wire in the registry on `grant`:** reject grants for unregistered capabilities, for `subject` kinds not in `allowedSubjectKinds`, and validate `scope` against `scopeSchema` when present.
- **Wire in the trust policy on `grant`:** when a grant decision is `auto-granted`, assert the trust policy permits auto-grant for that (package, capability); never auto-grant when policy says consent/deny. (The service already accepts `trustPolicy` in its constructor but never uses it.)
- **Implied-grant scope/expiry propagation:** when authorizing via `getImplied`, carry the implying grant's scope as an upper bound (implied scope ⊆ implying scope) and respect the implying grant's `expiresAt`; never return an unscoped allow derived from a scoped grant.
- **Scope-aware `check`:** extend `check`/result to compare a requested scope against the matched grant's scope using a shared `scopeMatches` (align with `services/capabilities/scope.ts` rather than duplicating).
- Replace direct `Date.now()` reads with an injected clock (already needed for deterministic tests) and produce ISO-8601 timestamps per contract.

### Phase 3 — `capability-registry.ts`: authoritative namespaces
- Introduce reserved-namespace policy: `mog`/`mog:*` registrable only by owner packages matching `@mog/*` (or an explicit allowlist); reject otherwise.
- Close the short-ID bypass: 1–2 segment IDs must still be subject to ownership/validation (either reject unnamespaced IDs for non-core registration, or assign them to a reserved `legacy` owner that only core may use).
- Keep append-only immutability and the atomic `registerBatch`; add a registry validation that `implies` targets are themselves registered (no dangling implied edges) and that `implies` has no cycles (the BFS already de-dups but should reject cycles at registration time for clarity).

### Phase 4 — `trust-policy.ts`: hardening
- Authenticate trust signals: `bundled`/`signature`/`enterprisePolicyId` must come from a verified install record, not a self-asserted flag; document the provenance source and treat unverified flags as untrusted.
- First-party auto-grant must exclude `critical`-tier and any `restrictedCapabilities` unless an explicit `firstPartyAutoGrantCapabilities` entry opts them in; never return "all" for critical caps.
- Apply `restrictedCapabilities` to the `denyList` for **all** non-bundled sources (enterprise/marketplace/local-dev already do; verify and keep), and add critical-cap restriction to bundled too.
- Keep `DEFAULT_FIRST_PARTY_PACKAGES` but source it from the manifest/`isFirstPartyApp` path used by `services/capabilities/manifest.ts` so there is one first-party list, not two.

### Phase 5 — retire `legacy-adapter.ts` (no shim)
- The adapter's only documented consumer is `launch-app.ts` ("allows gradual migration of launch-app.ts"). Migrate that call site (and any others surfaced by a fresh search) to construct `CapabilitySubject`s directly via `createCapabilitySubject({ packageId, appId })`.
- Remove `LegacyGrantServiceAdapter` and `createLegacyGrantServiceAdapter` once call sites are migrated. Per the no-shim constraint, the adapter is explicitly a temporary bridge and is deleted, not preserved.

### Phase 6 — wire & export
- Update `services/capabilities/*` so the AppId-keyed store becomes a thin internal detail behind the subject service (or is replaced by it), keeping the `@mog-sdk/kernel/security` barrel exports stable for `launch-app.ts`/settings UI.
- Export the reconciled subject-based service **interfaces and pure helpers** from `index.ts`; keep concrete service/store factories behind `@mog-sdk/app-platform` per the existing boundary doc in the barrel header.

## Tests and verification gates

- **Unit (extend existing `__tests__`):**
  - `capability-subject.test.ts` — keep; add branded-type round-trips.
  - `grant-service.test.ts` — add: deny-precedence over broader allow; most-specific-allow wins; revoke defeats a surviving broader allow (tombstone); implied capability inherits (never widens) implying scope and expiry; grant rejected for unregistered cap / disallowed subject kind / schema-invalid scope; auto-grant blocked when trust policy denies; injected-clock expiry.
  - `capability-registry.test.ts` — add: reserved `mog` namespace rejects non-`@mog/*` owner; short-ID no longer bypasses ownership; dangling/cyclic `implies` rejected at registration.
  - `trust-policy.test.ts` — add: first-party does **not** auto-grant `critical`/restricted by default; unverified `bundled` flag is not trusted; restricted list applied across sources.
- **Contract conformance gate:** a type-level assertion test that `CapabilitySubject`/`CapabilityGrant`/`TrustPolicyDecision`/service interfaces in this folder are assignable to/from the `@mog-sdk/app-platform` contract types (fails the build if they drift again).
- **Integration:** an app-launch path test (or app-eval scenario) proving consent/grant/deny still flows end-to-end through `launch-app.ts` after the adapter is removed and subjects are used directly.
- **Standard gates:** kernel typecheck, kernel + app-platform package builds, full unit suite, and the relevant app-eval consent/permissions scenarios. (This planning task does not run them; they are the gates for the implementing change.)

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Cross-package contract change** (Phases 0/2): adopting ISO timestamps + list-form `TrustPolicyDecision` + additive `expiresAt` touches `mog/types/app-platform`. Must be coordinated and rolled out without breaking the active `services/capabilities` consumers mid-flight. Sequence: land contract additions → conform kernel impl → migrate consumers → remove old keying/adapter.
- **Silent behavior change at the boundary:** moving from AppId-keying to subject-keying can change which grants match. Migration must default AppId-only grants to `{ appId }` subjects so existing grants keep matching exactly.
- **Persistence/format:** if grants are persisted by `services/capabilities/stores`, changing the grant shape (timestamp type) requires a migration of stored records; treat as a real data migration, not an in-place reinterpret.
- **Revocation tombstones** must be garbage-collected/superseded on re-grant so a revoked-then-regranted capability is honored.
- **Performance:** "collect all matches" in `check` is O(n) over grants; fine for current scale but note an index by `capabilityId` if grant counts grow.

**Non-goals:**
- Redesigning the consent UI, audit-logger, re-auth, or sensitive-handler internals (separate folders/plans) beyond what wiring requires.
- Adding new capability domains beyond reconciling existing ones.
- Network/clipboard runtime sandboxing implementation (this folder decides *whether* a capability is held, not the syscall-level enforcement).

## Parallelization notes and dependencies on other folders

- **Hard dependency (do first):** `mog/types/app-platform/src/{capabilities,trust}/types.ts` — contract decisions in Phase 0 gate Phases 2–4. Coordinate with that folder's owner/plan before conforming impls.
- **Tight coupling:** `mog/kernel/src/services/capabilities/*` is the currently-live system; Phases 2/6 must converge with it (single registry, single first-party list via `manifest.ts`, shared `scope.ts::scopeMatches`). Best done by the same worker or in lockstep to avoid a second divergence.
- **Downstream consumers to migrate (Phase 5/6):** `mog/shell/src/app-launcher/launch-app.ts`, `capability-context.tsx`, `hooks/use-app-kernel.ts`, settings components (`AppPermissionsSettings.tsx`, `PermissionHistory.tsx`, `AuditLogEntry.tsx`), capability dialog/item components. These can be updated in parallel once the barrel surface is frozen.
- **Independent / parallelizable:** the four `__tests__` extensions, the namespace-authority work in `capability-registry.ts`, and the trust-policy hardening can proceed concurrently once Phase 0 is settled, since they touch distinct files.

---

### Evidence appendix (read-only findings)
- `index.ts` re-exports exclusively from `../services/capabilities/*`; none of the local `security/*.ts` service symbols are exported.
- Repo-wide search: `CapabilitySubject|CapabilityGrantService|CapabilityRegistryService|TrustPolicyService|LegacyGrantServiceAdapter` appears only inside `mog/kernel/src/security/**` (impl + tests) and as separate **type** declarations in `mog/types/app-platform/src/**`. No production runtime importer.
- `grant-service.ts`: `findMatchingGrant` returns the first `Map`-iteration match (order-dependent); `revoke` deletes only the exact key; injected `trustPolicy` and `registryService.scopeSchema` are unused on `grant`; implied caps returned with no scope/expiry.
- `trust-policy.ts`: bundled first-party `canAutoGrant` returns `true` for all capabilities (including `mog:network:unrestricted`, `riskTier: 'critical'`) when `firstPartyAutoGrantCapabilities` is unset; `bundled` is a self-asserted flag.
- `capability-registry.ts`: `extractNamespace` returns `undefined` for <3-segment IDs ⇒ ownership bypass; namespace ownership is first-come.
- Contract drift vs `app-platform`: grant timestamp (number vs ISO string), `grant` return type (object vs void), `TrustPolicyDecision` (lists vs single `canAutoGrant`), `evaluateTrust` signature.
