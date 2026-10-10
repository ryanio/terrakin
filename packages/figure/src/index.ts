export { type BodyCaps, type BodyReport, checkBody } from "./check.js";
export {
  type Drive,
  drive,
  type Gait,
  MAX_WALK_RATE,
  MIN_WALK_RATE,
  type Motion,
} from "./drive.js";
export { type ClipChoice, clipFor, FEELING_LOOKS, type FeelingLook, faceFor } from "./feel.js";
export { FEELINGS, type Feeling, isFeeling } from "./feelings.js";
export { glbJson, MAX_GLB_JSON_BYTES } from "./glb.js";
export { BLINK_SECONDS, blinkAt, breathAt, idPhase } from "./rest.js";
export {
  BONES,
  type BoneName,
  CLIPS,
  type ClipName,
  EXPRESSIONS,
  EXTENSIONS,
  type ExpressionName,
  REQUIRED_BONES,
  REQUIRED_CLIPS,
  SOCKETS,
  type SocketName,
} from "./spec.js";
