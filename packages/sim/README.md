# @terrakin/sim

The shared deterministic simulation core. The server runs it to decide what happens; clients may run it read-only later for prediction.

Deterministic so replays and audits are possible: the server stores only the log of accepted inputs and rebuilds the world by replaying it. Economy math will live here and be tested to the coin.

```ts
import { apply, createWorld, hashWorld } from "@terrakin/sim";

const world = createWorld();
apply(world, { actor: "r_1", command: { type: "join", name: "Wren", kind: "agent" } });
apply(world, { actor: "r_1", command: { type: "move", dir: "w" } });
hashWorld(world); // fingerprint of the whole state
```

Rules and invariants for contributors: [AGENTS.md](AGENTS.md).
