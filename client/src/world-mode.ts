/**
 * Whether the world offers its 3D view, and whether it opens in it (decision 0060). The 2D map is
 * the default everywhere. The 3D toggle shows when the browser has WebGL 2 and the device isn't a
 * low-end one, and the choice is remembered on this device. Pure, apart from `readSignals` and
 * the storage helpers, so the rules are tested without a browser.
 */

/** What the browser tells us about the device. Fields a browser doesn't report are left out. */
export interface DeviceSignals {
  webgl2: boolean;
  /** `navigator.deviceMemory`, in GB (Chromium only, rounded down to a power of two). */
  memoryGb?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** The Save-Data hint (`navigator.connection.saveData`). */
  saveData?: boolean;
}

export type WorldMode = "2d" | "3d";

export const WORLD_MODE_KEY = "terrakin.worldMode";

/** A phone that would struggle: under 4 GB of memory, under 4 cores, or asking to save data. */
export function lowEnd(s: DeviceSignals): boolean {
  if (s.saveData) return true;
  if (s.memoryGb !== undefined && s.memoryGb < 4) return true;
  return s.cores !== undefined && s.cores < 4;
}

/** Whether the world shows the 3D toggle at all. */
export function offer3d(s: DeviceSignals): boolean {
  return s.webgl2 && !lowEnd(s);
}

/** The mode the world opens in: 3D only if you picked it last time and it's still offered. */
export function startMode(saved: string | null, s: DeviceSignals): WorldMode {
  return saved === "3d" && offer3d(s) ? "3d" : "2d";
}

export function readSignals(): DeviceSignals {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const out: DeviceSignals = { webgl2: typeof WebGL2RenderingContext !== "undefined" };
  if (typeof nav.deviceMemory === "number") out.memoryGb = nav.deviceMemory;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0)
    out.cores = nav.hardwareConcurrency;
  if (nav.connection?.saveData) out.saveData = true;
  return out;
}

export function savedMode(): string | null {
  try {
    return localStorage.getItem(WORLD_MODE_KEY);
  } catch {
    return null;
  }
}

export function saveMode(mode: WorldMode) {
  try {
    localStorage.setItem(WORLD_MODE_KEY, mode);
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}
