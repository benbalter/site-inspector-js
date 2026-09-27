#!/usr/bin/env node
import { buildProgram } from "./program.js";

await buildProgram().parseAsync();

// Exit once output is flushed, even if an abandoned check (e.g. one that timed
// out) still holds a socket or timer open.
process.stdout.write("", () => process.exit());
