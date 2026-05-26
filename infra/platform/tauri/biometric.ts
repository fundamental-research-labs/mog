import { secureInvoke } from './secure-invoke';

export enum BiometryType {
  None = 0,
  Auto = 1,
  TouchID = 2,
  FaceID = 3,
}

/**
 * Biometric status with availability flag.
 */
export interface BiometricStatus {
  /** Whether biometric authentication is available on this device */
  isAvailable: boolean;
  /** The type of biometric available (TouchID, FaceID, etc.) */
  biometryType: BiometryType;
  /** Human-readable name of the biometric type */
  biometryTypeName: string;
  /** Error message if biometrics are not available */
  error?: string;
  /** Native plugin error code if biometrics are not available */
  errorCode?: string;
}

/**
 * Convert BiometryType enum to human-readable string.
 */
function getBiometryTypeName(type: BiometryType): string {
  switch (type) {
    case BiometryType.None:
      return 'None';
    case BiometryType.TouchID:
      return 'Touch ID';
    case BiometryType.FaceID:
      return 'Face ID';
    case BiometryType.Auto:
      return 'Windows Hello';
    default:
      return 'Unknown';
  }
}

/**
 * Check if biometric authentication is available on this device.
 *
 * The native biometry plugin is intentionally not exposed directly to webviews.
 * This uses a Mog-owned command that only returns availability metadata; actual
 * authentication remains enforced by Rust middleware for Critical commands.
 *
 * @returns Biometric status including availability and type
 */
export async function checkStatus(): Promise<BiometricStatus> {
  try {
    const status = await secureInvoke<BiometricStatus>('biometric_status');
    return {
      ...status,
      biometryTypeName: status.biometryTypeName || getBiometryTypeName(status.biometryType),
    };
  } catch (error) {
    return {
      isAvailable: false,
      biometryType: BiometryType.None,
      biometryTypeName: 'None',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if biometric authentication is available.
 *
 * Convenience method that returns a simple boolean.
 *
 * @returns true if biometrics are available
 */
export async function isAvailable(): Promise<boolean> {
  const status = await checkStatus();
  return status.isAvailable;
}

/**
 * Biometric authentication API.
 * Authentication itself is intentionally Rust-only and tied to Critical commands.
 */
export const biometric = {
  /** Check the status of biometric authentication */
  checkStatus,
  /** Check if biometrics are available (convenience method) */
  isAvailable,
  /** BiometryType enum for type checking */
  BiometryType,
};
