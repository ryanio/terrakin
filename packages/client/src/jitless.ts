/**
 * zod probes for `new Function` when it builds an object schema, to decide whether it may compile
 * fast parsers. The CSP forbids eval, so the probe shows up as a violation even though zod catches
 * it. The app (main.ts) and the docs page import this first, so the switch is set before the
 * protocol schemas and Scalar (which uses the same zod) are built.
 */
import { z } from "zod";

z.config({ jitless: true });
