/**
 * Which portrait each townsfolk resident gets as its avatar, and whether it already has it
 * (decision 0220). Pure, so the tests feed it fixtures; avatars.ts does the reading and the writing.
 */
/** The portrait files a pick names: `<handle>-<n>.png` in the folder. */
export const portraitFile = (handle: string, n: number) => `${handle}-${n}.png`;

/**
 * `--pick juniper=1,bram=2,...` as handle to candidate number. Every handle must be a townsfolk
 * one, named once, with a whole number from 1. A subset is fine: the rest keep their avatars.
 */
export function parsePicks(
  spec: string,
  handles: readonly string[],
): { ok: true; picks: Map<string, number> } | { ok: false; error: string } {
  const picks = new Map<string, number>();
  for (const part of spec.split(",").map((s) => s.trim())) {
    if (!part) continue;
    const m = /^([a-z0-9_]+)=(\d+)$/.exec(part);
    if (!m?.[1] || !m[2]) return { ok: false, error: `"${part}" isn't handle=number` };
    const [, handle, n] = m;
    if (!handles.includes(handle)) return { ok: false, error: `@${handle} isn't townsfolk` };
    if (picks.has(handle)) return { ok: false, error: `@${handle} is picked twice` };
    if (Number(n) < 1) return { ok: false, error: `${handle}=${n}: candidates start at 1` };
    picks.set(handle, Number(n));
  }
  if (picks.size === 0) return { ok: false, error: "no picks; try --pick juniper=1,bram=2" };
  return { ok: true, picks };
}

/**
 * The server's cap on an image upload (`MEDIA_TYPES` in packages/protocol, which plain Node can't
 * import from here; the test checks they agree).
 */
export const IMAGE_MAX_BYTES = 5_000_000;
/** A portrait at least this wide reads sharp on a phone's profile page. */
const MIN_SIDE = 256;

/** Why a portrait file won't do as an avatar, or undefined when it will: a square PNG, small enough to upload. */
export function checkPortrait(bytes: Uint8Array): string | undefined {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || png.some((b, i) => bytes[i] !== b)) return "isn't a PNG";
  if (bytes.length > IMAGE_MAX_BYTES) return `is ${bytes.length} bytes, over the upload cap`;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== height) return `is ${width}x${height}, not square`;
  if (width < MIN_SIDE) return `is ${width}px, under ${MIN_SIDE}`;
  return undefined;
}

/** What the credentials file remembers of a portrait set as an avatar. */
export interface PortraitRecord {
  /** SHA-256 of the file uploaded, in hex. */
  sha256: string;
  /** The media id it was stored as. */
  media: string;
}

export type AvatarStep =
  /** Upload the file and set it with `PUT /v1/profile {"avatar": ...}`. */
  | { kind: "set"; file: string }
  /** The profile already shows this portrait. */
  | { kind: "done"; file: string }
  /** No stored resident for this persona on this server: seed it first. */
  | { kind: "unseeded" }
  /** The file is missing or won't do. */
  | { kind: "bad"; file: string; problem: string };

/**
 * One persona's step. `bytes` is the picked file (undefined when it's missing), `sha256` its hash,
 * `stored` what the credentials file holds for the persona, and `avatar` the avatar URL its public
 * profile shows now (`/media/m_...`, or null).
 */
export function planAvatar(input: {
  file: string;
  bytes: Uint8Array | undefined;
  sha256: string;
  stored: { portrait?: PortraitRecord } | undefined;
  avatar: string | null;
}): AvatarStep {
  const { file, bytes, sha256, stored, avatar } = input;
  if (!stored) return { kind: "unseeded" };
  if (!bytes) return { kind: "bad", file, problem: "isn't there" };
  const problem = checkPortrait(bytes);
  if (problem) return { kind: "bad", file, problem };
  const shown = avatar?.split("/").pop();
  if (stored.portrait?.sha256 === sha256 && shown === stored.portrait.media) {
    return { kind: "done", file };
  }
  return { kind: "set", file };
}

/** One line for the run's output. File names and codes only, never a token. */
export function describeAvatarStep(step: AvatarStep, send: boolean): string {
  switch (step.kind) {
    case "set":
      return send
        ? `uploading ${step.file} as the avatar`
        : `would upload ${step.file} as the avatar`;
    case "done":
      return `already shows ${step.file}`;
    case "unseeded":
      return "isn't in the credentials file; seed it first";
    case "bad":
      return `${step.file} ${step.problem}; skipped`;
  }
}
