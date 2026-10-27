import { z } from "zod";

/**
 * Imported first in main.tsx. Turns off zod's JIT, whose `new Function` probe is blocked by the
 * CSP (no 'unsafe-eval') and shows up as a securitypolicyviolation in the console.
 */
z.config({ jitless: true });
