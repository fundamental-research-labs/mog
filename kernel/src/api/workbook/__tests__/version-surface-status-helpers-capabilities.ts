type SurfaceCapabilityForAssertion = {
  readonly enabled: boolean;
  readonly dependency?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
};

export function capabilityState(
  surface: { readonly capabilities: object },
  capability: string,
): SurfaceCapabilityForAssertion {
  return (surface.capabilities as Record<string, SurfaceCapabilityForAssertion>)[capability];
}
