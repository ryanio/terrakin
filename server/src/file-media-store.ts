import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_ID, type ReadableMediaStore } from "./media";

/** Uploads as plain files in a directory, for the Node server. The id is the file name. */
export class FileMediaStore implements ReadableMediaStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async put(id: string, bytes: Uint8Array) {
    if (!MEDIA_ID.test(id)) throw new Error(`Bad media id ${id}`);
    await writeFile(join(this.dir, id), bytes);
  }

  async delete(id: string) {
    if (MEDIA_ID.test(id)) await rm(join(this.dir, id), { force: true });
  }

  async get(id: string) {
    if (!MEDIA_ID.test(id)) return undefined;
    try {
      return new Uint8Array(await readFile(join(this.dir, id)));
    } catch {
      return undefined;
    }
  }
}
