import { STOREYS } from "@terrakin/sim";

/**
 * A storey in the words people see (RFC 0028, its first decision): "Ground floor", and "Upstairs"
 * while a home goes up one storey. The web's pickers and the plot photo's facts line both say it.
 */
export function storeyName(storey: number): string {
  if (storey === 0) return "Ground floor";
  return STOREYS.max === 1 ? "Upstairs" : `Storey ${storey}`;
}
