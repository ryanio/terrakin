/**
 * zod probes for `new Function` when it builds an object schema. The admin host's policy forbids
 * eval, so the probe would show up as a violation even though zod catches it. main.ts imports this
 * first, before any protocol schema is built (the same switch as client/src/jitless.ts).
 */
import { z } from "zod";

z.config({ jitless: true });
