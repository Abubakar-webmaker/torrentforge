import { createServer } from "node:http";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Server as TrackerServer } from "bittorrent-tracker";
import WebTorrent from "webtorrent";
import createTorrent from "create-torrent";

const TEST_DIR = join(process.cwd(), "test-swarm");
const SEED_FILE_PATH = join(TEST_DIR, "test-file.txt");
const TORRENT_OUTPUT_PATH = join(TEST_DIR, "test-file.torrent");
const TRACKER_PORT = 9999;

async function main() {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

  if (!existsSync(SEED_FILE_PATH)) {
    console.log("Creating test file...");
    const chunk = "TorrentForge-Test-Data-Block-";
    const content = chunk.repeat(20000);
    writeFileSync(SEED_FILE_PATH, content);
  }

  const tracker = new TrackerServer({
    udp: false,
    http: true,
    ws: false,
  });

  tracker.on("error", (err: Error) => console.error("Tracker error:", err));
  tracker.on("warning", (err: Error) => console.warn("Tracker warning:", err.message));

  await new Promise<void>((resolve) => {
    tracker.listen(TRACKER_PORT, "127.0.0.1", () => {
      console.log(`✅ Local tracker running on http://127.0.0.1:${TRACKER_PORT}/announce`);
      resolve();
    });
  });

  const torrentBuffer: Buffer = await new Promise((resolve, reject) => {
    createTorrent(
      SEED_FILE_PATH,
      {
        announceList: [[`http://127.0.0.1:${TRACKER_PORT}/announce`]],
        pieceLength: 16384,
      },
      (err: Error | null, torrent: Buffer) => {
        if (err) reject(err);
        else resolve(torrent);
      }
    );
  });

  writeFileSync(TORRENT_OUTPUT_PATH, torrentBuffer);
  console.log(`✅ Torrent file created: ${TORRENT_OUTPUT_PATH}`);

  const client = new WebTorrent();

  client.seed(SEED_FILE_PATH, { announceList: [[`http://127.0.0.1:${TRACKER_PORT}/announce`]] }, (torrent: any) => {
    console.log(`✅ Seeding started — info hash: ${torrent.infoHash}`);
    console.log("");
    console.log("=== Ready for TorrentForge test ===");
    console.log(`Run: node dist/src/cli/index.js download ${TORRENT_OUTPUT_PATH} -o ./test-swarm/downloaded --log-level debug`);
  });
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
