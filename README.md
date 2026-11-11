# TorrentForge

A professional-grade BitTorrent client built from scratch in TypeScript/Node.js — implementing the core BitTorrent protocol (BEP 3, 12, 15, 23) without relying on any existing torrent libraries.

## Features

- **Custom bencode codec** — full encoder/decoder for the `.torrent` file format
- **Dual tracker support** — both HTTP and UDP trackers (BEP 15), with multi-tracker fallback (BEP 12)
- **Full peer wire protocol** — handshake, choke/unchoke, bitfield, have, request, piece, cancel
- **Rarest-first piece scheduling** — for healthier swarm distribution
- **Concurrent multi-peer downloading** — event-driven, non-blocking I/O
- **Parallel SHA1 verification** via `worker_threads` — hashing never blocks the event loop
- **Multi-file torrent support** — correct byte-offset mapping across file boundaries
- **Stall detection & automatic re-request** — unresponsive peers are dropped and their pieces reassigned
- **Periodic re-announce & peer pool refill** — keeps the swarm populated over long downloads
- **Graceful shutdown** (Ctrl+C) — clean resource teardown
- **91+ automated tests** (unit + integration, including fake TCP/UDP servers)

## Architecture

torrent file → Bencode Decoder → Torrent Parser → Tracker Client (HTTP/UDP)
↓
Peer List
↓
Peer Sessions (concurrent)
↓
Piece Scheduler (rarest-first) + Verifier (worker pool)
↓
Disk Writer


See `/src` for the full module breakdown (bencode, torrent-file, tracker, peer, piece-manager, download-session).

## Installation

\`\`\`bash
npm install
npm run build
\`\`\`

## Usage

\`\`\`bash
node dist/cli/index.js download <path-to-file.torrent> -o ./downloads --log-level info
\`\`\`

### Options

| Flag | Description | Default |
|---|---|---|
| `-o, --output <dir>` | Output directory | `./downloads` |
| `-p, --port <port>` | Listen port | `6881` |
| `--max-peers <n>` | Max concurrent peer connections | `40` |
| `--log-level <level>` | `debug \| info \| warn \| error` | `info` |

## Testing

\`\`\`bash
npm test
\`\`\`

## Roadmap (Future Enhancements)

- AI-based smart piece scheduling (ML-predicted fastest peer per piece)
- Swarm health analytics dashboard
- Reputation-based anti-leech system
- WebRTC bridge for browser-based peers
- Adaptive bandwidth throttling
- Merkle tree-based verification (BitTorrent v2 / BEP 52)

## License

MIT