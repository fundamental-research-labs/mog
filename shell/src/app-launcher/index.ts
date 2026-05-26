/**
 * App Launcher - Exports
 */

export {
  TRUSTED_FIRST_PARTY_APPS,
  canLaunchWithoutConsent,
  getCapabilitiesRequiringConsent,
  launchApp,
} from './launch-app';

export type {
  AppLaunchResult,
  ConsentRequest,
  ConsentResult,
  CreateGatedApiFn,
  LaunchAppOptions,
  ShowConsentDialogFn,
} from './launch-app';
