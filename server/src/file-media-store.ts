import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type MediaStore, STORE_KEY } from "./media";

/** Uploads as plain files in a directory, for the Node server. The key is the file name. */
export class FileMediaStore implements MediaStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async put(id: string, bytes: Uint8Array) {
    if (!STORE_KEY.test(id)) throw new Error(`Bad media key ${id}`);
    await writeFile(join(this.dir, id), bytes);
  }

  async delete(id: string) {
    if (STORE_KEY.test(id)) await rm(join(this.dir, id), { force: true });
  }

  async get(id: string) {
    if (!STORE_KEY.test(id)) return undefined;
    try {
      return new Uint8Array(await readFile(join(this.dir, id)));
    } catch {
      return undefined;
    }
  }
}
