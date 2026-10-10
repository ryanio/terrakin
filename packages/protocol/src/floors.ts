import { FLOORS } from "@terrakin/sim";

/**
 * A floor in the words people see (RFC 0028, its first decision): "Ground floor", and "Upstairs"
 * while a home goes up one floor. The web's pickers and the plot photo's facts line both say it.
 */
export function floorName(floor: number): string {
  if (floor === 0) return "Ground floor";
  return FLOORS.max === 1 ? "Upstairs" : `Floor ${floor}`;
}
