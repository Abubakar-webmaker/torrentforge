import { z } from "zod";

export const ConfigSchema = z.object({
  outputDir: z.string().min(1),
  maxConcurrentPeers: z.number().int().positive().default(40),
  blockRequestTimeoutMs: z.number().int().positive().default(10_000),
  peerConnectTimeoutMs: z.number().int().positive().default(10_000),
  trackerAnnounceIntervalFallbackSec: z.number().int().positive().default(1800),
  listenPort: z.number().int().min(1024).max(65535).default(6881),
  maxPendingBlockRequestsPerPeer: z.number().int().positive().default(5),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Validates and fills in defaults for user-supplied partial config. */
export function parseConfig(input: Partial<Config> & { outputDir: string }): Config {
  return ConfigSchema.parse(input);
}