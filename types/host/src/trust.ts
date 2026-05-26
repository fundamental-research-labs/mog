export type HostTrustMode =
  | 'trusted-server'
  | 'trusted-desktop'
  | 'trusted-first-party-browser'
  | 'cooperative-local'
  | 'test';

export type HostIsolationModel =
  | 'cooperative-same-realm'
  | 'trusted-same-process'
  | 'iframe-protocol'
  | 'trusted-service-process'
  | 'native-desktop-process'
  | 'plugin-sandbox'
  | 'agent-executor'
  | 'test-fixture';

export type HostEnforcementOwner =
  | 'rust-policy-engine'
  | 'trusted-http-service'
  | 'iframe-child-app'
  | 'plugin-sandbox'
  | 'agent-executor'
  | 'trusted-adapter-factory'
  | 'storage-provider'
  | 'none-cooperative'
  | 'not-applicable';

export interface HostTrustEnforcementProfile {
  readonly identity: HostEnforcementOwner;
  readonly protocol: HostEnforcementOwner;
  readonly capability: HostEnforcementOwner;
  readonly workbookAccess: 'rust-policy-engine';
  readonly storage: HostEnforcementOwner;
}

export interface HostTrustProfile {
  readonly mode: HostTrustMode;
  readonly identityAssertion:
    | 'host-validated-session'
    | 'native-desktop-profile'
    | 'trusted-process'
    | 'test-fixture'
    | 'cooperative-caller';
  readonly enforcement: HostTrustEnforcementProfile;
  readonly isolation: HostIsolationModel;
}
