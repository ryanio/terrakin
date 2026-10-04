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
  coOwners = new Map<string, string[]>(); // plotKey -> residents the owner shares it with
  blocks = new Map<string, BlockKind>(); // tileKey -> block
  /** The tiles the Town Hall stands on. Tapping one opens /town. */
  townHall: { x: number; y: number }[];
  townBuilt = new Map<string, string>(); // tileKey -> the proposal that built it

  constructor(snapshot: WorldSnapshot) {
    this.config = snapshot.config;
    this.commons = snapshot.commons;
    this.seq = snapshot.seq;
    for (const r of snapshot.residents) this.residents.set(r.id, { ...r });
    for (const p of snapshot.plots) {
      this.plots.set(plotKey(p.px, p.py), p.ownerId);
      if (p.coOwners?.length) this.coOwners.set(plotKey(p.px, p.py), [...p.coOwners]);
    }
    for (const b of snapshot.blocks) this.blocks.set(tileKey(b.x, b.y), b.block);
    this.townHall = (snapshot.townHall ?? []).map((t) => ({ ...t }));
    for (const t of snapshot.townBuilt ?? []) this.townBuilt.set(tileKey(t.x, t.y), t.proposal);
  }

  isTownHall(x: number, y: number): boolean {
    return this.townHall.some((t) => t.x === x && t.y === y);
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
      case "plot_released": {
        // The sim sends plot_unshared for each co-owner first; this keeps a stale list from
        // outliving the plot if one is ever missed.
        const key = plotKey(event.px, event.py);
        this.plots.delete(key);
        this.coOwners.delete(key);
        break;
      }
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
      case "plot_shared": {
        const key = plotKey(event.px, event.py);
        this.coOwners.set(key, [...(this.coOwners.get(key) ?? []), event.residentId]);
        break;
      }
      case "plot_unshared": {
        const key = plotKey(event.px, event.py);
        const rest = (this.coOwners.get(key) ?? []).filter((id) => id !== event.residentId);
        if (rest.length > 0) this.coOwners.set(key, rest);
        else this.coOwners.delete(key);
        break;
      }
      case "hearth_cleared": {
        const r = this.residents.get(event.residentId);
        if (r) r.hearth = null;
        break;
      }
      // The blocks themselves arrive as block_placed and block_removed just before this.
      case "town_built":
        for (const b of event.placed) this.townBuilt.set(tileKey(b.x, b.y), event.proposal);
        for (const t of event.removed) this.townBuilt.delete(tileKey(t.x, t.y));
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

  /** Residents the owner shares the plot under a tile with. Empty if it isn't shared. */
  coOwnersAt(x: number, y: number): readonly string[] {
    const { plotSize } = this.config;
    return this.coOwners.get(plotKey(Math.floor(x / plotSize), Math.floor(y / plotSize))) ?? [];
  }
}
