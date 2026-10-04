import type { WorldSnapshot } from "@terrakin/protocol";
import {
  type BlockKind,
  plotKey,
  type Resident,
  tileKey,
  type WorldConfig,
  type WorldEvent,
} from "@terrakin/sim";

type EventMessage = { seq: number; event: WorldEvent };

/**
 * The client's read-only copy of the world. It never runs game rules: it only applies the events
 * the server sends. If it ever falls out of step, it asks for a fresh snapshot.
 */
export class Mirror {
  config: WorldConfig;
  commons: { px: number; py: number };
  seq: number;
  residents = new Map<string, Resident>();
  plots = new Map<string, string>(); // plotKey -> ownerId
  blocks = new Map<string, BlockKind>(); // tileKey -> block

  constructor(snapshot: WorldSnapshot) {
    this.config = snapshot.config;
    this.commons = snapshot.commons;
    this.seq = snapshot.seq;
    for (const r of snapshot.residents) this.residents.set(r.id, { ...r });
    for (const p of snapshot.plots) this.plots.set(plotKey(p.px, p.py), p.ownerId);
    for (const b of snapshot.blocks) this.blocks.set(tileKey(b.x, b.y), b.block);
  }

  /**
   * Apply one server event. Several events can share one seq (one action, many effects).
   * - "applied": done.
   * - "stale": already included in our snapshot; ignored.
   * - "gap": we missed something. The caller should reload the snapshot.
   */
  apply({ seq, event }: EventMessage): "applied" | "stale" | "gap" {
    if (seq < this.seq) return "stale";
    if (seq > this.seq + 1) return "gap";
    this.seq = seq;
    switch (event.type) {
      case "joined":
        this.residents.set(event.resident.id, { ...event.resident });
        break;
      case "left": {
        const r = this.residents.get(event.residentId);
        if (r) r.online = false;
        break;
      }
      case "profile_changed": {
        const r = this.residents.get(event.residentId);
        if (r) Object.assign(r, { color: event.color, shape: event.shape, note: event.note });
        break;
      }
      case "moved": {
        const r = this.residents.get(event.residentId);
        if (r) Object.assign(r, { x: event.x, y: event.y });
        break;
      }
      case "plot_claimed":
        this.plots.set(plotKey(event.px, event.py), event.ownerId);
        break;
      case "hearth_set": {
        const r = this.residents.get(event.residentId);
        if (r) r.hearth = { x: event.x, y: event.y };
        break;
      }
      case "block_placed":
        this.blocks.set(tileKey(event.x, event.y), event.block);
        break;
      case "block_removed":
        this.blocks.delete(tileKey(event.x, event.y));
        break;
    }
    return "applied";
  }

  /** The online resident standing on a tile, if any. */
  residentAt(x: number, y: number): Resident | undefined {
    for (const r of this.residents.values()) if (r.online && r.x === x && r.y === y) return r;
    return undefined;
  }

  ownerAt(x: number, y: number): string | undefined {
    const { plotSize } = this.config;
    return this.plots.get(plotKey(Math.floor(x / plotSize), Math.floor(y / plotSize)));
  }
}
