/**
 * The body spec: what a rigged character file holds so one loader can draw any of them.
 *
 * A body is one self-contained `.glb`. It is in meters, stands with its feet on y = 0, is centered
 * on the y axis, and faces +z with y up. Its height comes from whoever supplies it, not from the
 * file. Everything a loader looks for is found by the names below; any other name in the file is
 * ignored.
 */

/** The bones a body must have: the two every clip and every look-at turns. */
export const REQUIRED_BONES = ["Hips", "Head"] as const;

/** The shared skeleton. A body has the ones its shape has; a loader skips the rest. */
export const BONES = [
  "Hips",
  "Spine02",
  "Spine01",
  "Spine",
  "neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
] as const;

export type BoneName = (typeof BONES)[number];

/** Empty nodes where things a figure wears or holds attach. */
export const SOCKETS = [
  "socket_head",
  "socket_face",
  "socket_neck",
  "socket_back",
  "socket_hand_l",
  "socket_hand_r",
  "socket_halo",
  "socket_feet",
] as const;

export type SocketName = (typeof SOCKETS)[number];

/** The clip a body must have. Every other clip falls back to it. */
export const REQUIRED_CLIPS = ["idle"] as const;

/** The clips a loader knows how to use. A body may carry more under its own names. */
export const CLIPS = ["idle", "walk", "wave", "sit", "sleep", "hop", "flutter", "fly"] as const;

export type ClipName = (typeof CLIPS)[number];

/**
 * The face's morph targets, named in `extras.targetNames` on the mesh that holds them. All are
 * optional: a body without one shows that feeling in its clip alone.
 */
export const EXPRESSIONS = [
  "blink",
  "happy",
  "smile",
  "surprise",
  "sad",
  "shy",
  "squint",
  "sleepy",
] as const;

export type ExpressionName = (typeof EXPRESSIONS)[number];

/** The glTF extensions a body may require. A file that requires any other is refused. */
export const EXTENSIONS = [
  "KHR_mesh_quantization",
  "KHR_texture_transform",
  "KHR_texture_basisu",
  "EXT_texture_webp",
  "EXT_meshopt_compression",
] as const;
