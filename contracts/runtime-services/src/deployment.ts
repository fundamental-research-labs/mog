/** Deployment topology that determines how services discover each other. */
export type DeploymentProfile = 'local-dev' | 'single-node' | 'horizontal' | 'air-gapped';

/** Standard health-check response for liveness probes. */
export interface ServiceHealth {
  /** Whether the service considers itself alive. */
  healthy: boolean;

  /** Service name. */
  service: string;

  /** ISO-8601 timestamp of the check. */
  timestamp: string;
}

/** Readiness-check response for load-balancer probes. */
export interface ServiceReadiness {
  /** Whether the service is ready to accept traffic. */
  ready: boolean;

  /** Service name. */
  service: string;

  /** Per-dependency readiness (e.g. `{ "database": true, "cache": false }`). */
  dependencies: Record<string, boolean>;

  /** ISO-8601 timestamp of the check. */
  timestamp: string;
}

/**
 * Redacted diagnostics response for the admin/ops surface.
 *
 * SECURITY: Implementations must strip secrets, connection strings, and
 * credentials before populating. This type is designed to be safe to
 * expose to admin users and logging pipelines.
 */
export interface ServiceDiagnostics {
  /** Service name. */
  service: string;

  /** Service version string. */
  version: string;

  /** Active deployment profile. */
  deploymentProfile: DeploymentProfile;

  /** Uptime in seconds. */
  uptimeSeconds: number;

  /** Redacted configuration snapshot (key-value, no secrets). */
  config: Record<string, string | number | boolean>;

  /** ISO-8601 timestamp of the diagnostics snapshot. */
  timestamp: string;
}
