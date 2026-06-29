export function firstDisabledAvailability<T extends { readonly enabled: boolean }>(
  ...availabilities: readonly (T & { readonly disabledReason?: string })[]
): T & { readonly disabledReason?: string } {
  return availabilities.find((availability) => !availability.enabled) ?? availabilities[0]!;
}
