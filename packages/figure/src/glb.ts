/** The most JSON a body's file may carry, in bytes, unless the caller says otherwise. */
export const MAX_GLB_JSON_BYTES = 4 * 1024 * 1024;

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

/**
 * The JSON of a binary glTF file, parsed. The file is outside data: this reads the header and the
 * first chunk and nothing else, and throws with a message of its own when the bytes aren't a
 * version 2 `.glb` or the JSON is larger than `maxJsonBytes`.
 */
export function glbJson(bytes: Uint8Array, maxJsonBytes: number = MAX_GLB_JSON_BYTES): unknown {
  if (bytes.byteLength < 20) throw new Error("not a .glb: too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("not a .glb: wrong magic");
  if (view.getUint32(4, true) !== 2) throw new Error("not a .glb: not version 2");
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("not a .glb: its length doesn't match its header");
  }
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error("not a .glb: no JSON chunk first");
  if (length > maxJsonBytes) throw new Error("a .glb with too much JSON");
  if (20 + length > bytes.byteLength) throw new Error("not a .glb: its JSON runs past its end");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + length));
  return JSON.parse(text);
}
