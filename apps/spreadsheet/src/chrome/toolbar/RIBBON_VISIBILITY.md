# Ribbon Visibility Config

The ribbon visibility config is the rollout control for the spreadsheet command surface. It is separate from command authorization: hiding a button keeps staged UI out of public builds, while action handlers and read-only policy still enforce whether a command may run.

The config mirrors the rendered ribbon hierarchy:

```ts
const ribbonVisibility = {
  home: true,
  pageLayout: {
    themes: false,
  },
};
```

The same config also carries the chrome command surfaces that users perceive as part of the
spreadsheet command area, including the formula bar AI controls and the collaboration controls in
the ribbon tab bar:

```ts
const ribbonVisibility = {
  formulaBar: {
    controls: {
      toggleAiFormulaBar: false,
    },
  },
  collaboration: {
    tabBar: {
      collaborate: false,
    },
  },
};
```

Every node defaults to visible when omitted. Any node can be a boolean or an object:

- `false` hides that tab, group, or button and its descendants.
- `true` shows that tab, group, or button and its descendants, overriding lower-priority profile defaults.
- An object lets descendants opt in or out independently.

The canonical schema and type live in `contracts/src/ribbon/visibility-config.ts` as `RibbonVisibilityConfig`. The same config is accepted through `FeatureGates.ribbonVisibility`.

Named profiles are selected with `VITE_MOG_RIBBON_VISIBILITY_PROFILE` in browser builds, or `MOG_RIBBON_VISIBILITY_PROFILE` in Node/Jest contexts:

- `public` is the default build profile.
- `app-eval` shows every tab and group so evals can exercise the full internal surface.
- `all` is an alias for `app-eval`.

Explicit `FeatureGates.ribbonVisibility` values are merged over the selected profile, so embeds and local repros can override a named profile without changing build configuration.

For app-eval and local repros that need a one-off override without adding a named profile, `VITE_MOG_RIBBON_VISIBILITY_CONFIG_JSON` or `MOG_RIBBON_VISIBILITY_CONFIG_JSON` may contain a JSON object with the same shape. The merge order is named profile, then JSON env override, then explicit `FeatureGates.ribbonVisibility`.
