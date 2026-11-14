#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { parseTorrentFile } from "../torrent-file/parser.js";
import { parseConfig } from "../config/config.js";
import { DownloadSession } from "../download-session/session.js";
import { createLogger } from "../utils/logger.js";

const program = new Command();

program
  .name("torrentforge")
  .description("A professional-grade BitTorrent client built from scratch")
  .version("1.0.0");

program
  .command("download")
  .description("Download a torrent from a .torrent file")
  .argument("<torrentFile>", "path to the .torrent file")
  .option("-o, --output <dir>", "output directory", "./downloads")
  .option("-p, --port <port>", "listen port", "6881")
  .option("--max-peers <n>", "max concurrent peers", "40")
  .option("--log-level <level>", "log level (debug|info|warn|error)", "info")
  .action(async (torrentFile: string, opts) => {
    const logger = createLogger(opts.logLevel);

    try {
      logger.info(`Reading torrent file: ${torrentFile}`);
      const raw = await readFile(torrentFile);
      const torrent = parseTorrentFile(raw);

      logger.info(`Torrent: "${torrent.name}" — ${torrent.totalLength} bytes, ${torrent.pieceHashes.length} pieces`);
      logger.info(`Info hash: ${torrent.infoHash.toString("hex")}`);

      const config = parseConfig({
        outputDir: opts.output,
        listenPort: Number(opts.port),
        maxConcurrentPeers: Number(opts.maxPeers),
        logLevel: opts.logLevel,
      });

      const session = new DownloadSession(torrent, config);

      process.on("SIGINT", () => {
        logger.info("Received interrupt signal — shutting down gracefully...");
        void session.stop().then(() => {
          logger.info("Shutdown complete. Partial download saved (files are pre-allocated; re-run to resume piece-checking later).");
          process.exit(0);
        });
      });

      session.on("peerConnected", (peerKey) => {
        logger.debug(`Peer connected: ${peerKey}`);
      });

      session.on("peerDisconnected", (peerKey) => {
        logger.debug(`Peer disconnected: ${peerKey}`);
      });

      session.on("progress", (snapshot) => {
        const speedKBs = (snapshot.downloadSpeedBps / 1024).toFixed(1);
        logger.info(
          `Progress: ${snapshot.percentComplete.toFixed(1)}% ` +
          `(${snapshot.completedPieces}/${snapshot.totalPieces} pieces) ` +
          `— ${speedKBs} KB/s`
        );
      });

      session.on("error", (err) => {
        logger.warn(`Non-fatal error: ${err.message}`);
        if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
          logger.warn("💡 Hint: If using a local tracker, this might be a Windows Firewall issue.");
          logger.warn("   Try: 1) Disable Windows Defender Firewall temporarily, or");
          logger.warn("        2) Add Node.js to firewall exceptions");
        }
      });

      session.on("complete", () => {
        logger.info(`✅ Download complete! Files saved to: ${config.outputDir}`);
      });

      await session.start();
      process.exit(0);
    } catch (err) {
      logger.error(`Fatal error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();