# TorrentForge

A professional-grade BitTorrent client built from scratch in TypeScript/Node.js — implementing the core BitTorrent protocol (BEP 3, 12, 15, 23) without relying on any existing torrent libraries.

Verified end-to-end against a real local BitTorrent swarm: the downloaded file is byte-identical to the original, confirming the full pipeline — tracker communication, peer handshake, wire protocol, piece scheduling, SHA1 verification, and disk writing — works correctly.

## Features

- **Custom bencode codec** — full encoder/decoder for the `.torrent` file format, with round-trip tested edge cases
- **Dual tracker support** — both HTTP and UDP trackers (BEP 15), with multi-tracker fallback (BEP 12)
- **Full peer wire protocol** — handshake, choke/unchoke, bitfield, have, request, piece, cancel
- **Rarest-first piece scheduling** — for healthier swarm distribution
- **Concurrent multi-peer downloading** — event-driven, non-blocking I/O
- **Parallel SHA1 verification** via `worker_threads` — hashing never blocks the event loop
- **Multi-file torrent support** — correct byte-offset mapping across file boundaries
- **Stall detection & automatic re-request** — unresponsive peers are dropped and their pieces reassigned
- **Periodic re-announce & peer pool refill** — keeps the swarm populated over long downloads, with cooldown/retry limits to avoid connect-fail loops
- **Graceful shutdown** (Ctrl+C) — clean resource teardown
- **91 automated tests** (unit + integration, including fake TCP/UDP servers)
- **Verified against a real swarm** — not just unit tests; a live local tracker + seeder + this client, producing a byte-identical downloaded file

## Architecture

.torrent file → Bencode Decoder → Torrent Parser → Tracker Client (HTTP/UDP)
↓
Peer List
↓
Peer Sessions (concurrent)
↓
Piece Scheduler (rarest-first) + Verifier (worker pool)
↓
Disk Writer


See `/src` for the full module breakdown:
- `bencode/` — encode/decode
- `torrent-file/` — `.torrent` parsing, info-hash computation
- `tracker/` — HTTP/UDP tracker clients, peer ID generation
- `peer/` — handshake, wire protocol, TCP connection wrapper
- `piece-manager/` — bitfield, scheduler, disk writer, verifier, progress tracker, piece assembler
- `download-session/` — per-peer session logic and the orchestrator tying everything together
- `cli/` — command-line entry point

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
node dist/src/cli/index.js download <path-to-file.torrent> -o ./downloads --log-level info
```

### Options

| Flag | Description | Default |
|---|---|---|
| `-o, --output <dir>` | Output directory | `./downloads` |
| `-p, --port <port>` | Listen port | `6881` |
| `--max-peers <n>` | Max concurrent peer connections | `40` |
| `--log-level <level>` | `debug \| info \| warn \| error` | `info` |

## Testing

```bash
npm run build
npx vitest run
```

Runs 91 tests covering bencode round-trips, torrent parsing, HTTP/UDP tracker communication (against fake local servers), peer handshake and wire protocol (including TCP fragmentation handling), piece scheduling, disk writing (including multi-file splitting), SHA1 verification via worker threads, and stall detection.

### Local swarm integration test

For a full end-to-end test against a real swarm (without needing the internet or a large torrent):

```bash
npm run swarm
```

This spins up a local HTTP tracker and a WebTorrent seeder for a small test file, printing the exact `download` command to run against it in a second terminal. Comparing the downloaded file to the original with `fc /b` (Windows) or `diff` (Unix) confirms byte-for-byte correctness.

## Known limitations

- No DHT support — relies on tracker-announced peers only
- No peer-exchange (PEX)
- No magnet link support (requires a `.torrent` file)
- Single-tracker-tier announce strategy is sequential, not parallel across tiers

## Roadmap (future enhancements, not yet built)

- AI-based smart piece scheduling (ML-predicted fastest peer per piece)
- Swarm health analytics dashboard
- Reputation-based anti-leech system
- WebRTC bridge for browser-based peers
- Adaptive bandwidth throttling
- Merkle tree-based verification (BitTorrent v2 / BEP 52)

## License

MIT