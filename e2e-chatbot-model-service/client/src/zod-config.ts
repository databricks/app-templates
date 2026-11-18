import { config } from 'zod';

// Zod's JIT probe calls `new Function`, which the CSP blocks and reports as a violation.
// Zod runs the probe when a schema is created, so main.tsx imports this module first.
config({ jitless: true });
