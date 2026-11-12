import { EventEmitter } from "node:events";
import type { ParsedTorrent } from "../torrent-file/types.js";
import type { Config } from "../config/config.js";
import { PieceScheduler } from "../piece-manager/scheduler.js";
import { DiskWriter } from "../piece-manager/disk-writer.js";
import { PieceVerifier } from "../piece-manager/verifier.js";
import { ProgressTracker, type ProgressSnapshot } from "../piece-manager/progress-tracker.js";
import { announceHttp } from "../tracker/http-tracker.js";
import { announceUdp } from "../tracker/udp-tracker.js";
import { getPeerId } from "../tracker/peer-id.js";
import type { TrackerPeer } from "../tracker/types.js";
import { PeerSession } from "./peer-session.js";

export interface SessionEvents {
  progress: [snapshot: ProgressSnapshot];
  peerConnected: [peerKey: string];
  peerDisconnected: [peerKey: string];
  complete: [];
  error: [err: Error];
}

/**
 * Ties the whole pipeline together: announces to the tracker, connects
 * to peers, assigns pieces via the scheduler, verifies and writes
 * completed pieces to disk, and tracks overall progress — while keeping
 * each peer's failures isolated from the rest of the swarm.
 */
export class DownloadSession extends EventEmitter {
  private readonly torrent: ParsedTorrent;
  private readonly config: Config;
  private readonly myPeerId: Buffer;
  // Force rebuild

  private scheduler: PieceScheduler;
  private diskWriter: DiskWriter;
  private verifier: PieceVerifier;
  private progress: ProgressTracker;

  private sessions: Map<string, PeerSession> = new Map();
  private knownPeers: TrackerPeer[] = [];
  private stopped = false;
  private completionResolve: (() => void) | null = null;
  private reannounceTimer: NodeJS.Timeout | null = null;

  constructor(torrent: ParsedTorrent, config: Config) {
    super();
    this.torrent = torrent;
    this.config = config;
    this.myPeerId = getPeerId();

    this.scheduler = new PieceScheduler(torrent.pieceHashes.length);
    this.diskWriter = new DiskWriter(config.outputDir, torrent.files, torrent.pieceLength);
    this.verifier = new PieceVerifier();
    this.progress = new ProgressTracker(torrent.pieceHashes.length, torrent.totalLength);
  }

  /** Starts the download. Resolves once every piece is downloaded, verified and written. */
  async start(): Promise<void> {
    await this.diskWriter.init();

    const completionPromise = new Promise<void>((resolve) => {
      this.completionResolve = resolve;
    });

    await this.announceAndConnect();
    this.scheduleReannounce(this.config.trackerAnnounceIntervalFallbackSec);

    await completionPromise;
  }

  private async announceAndConnect(): Promise<void> {
    const peers = await this.announceToTrackers();
    this.knownPeers = peers;

    const toConnect = peers.slice(0, this.config.maxConcurrentPeers);
    for (const peer of toConnect) {
      this.spawnPeerSession(peer);
    }
  }

  private scheduleReannounce(intervalSec: number): void {
    if (this.stopped) return;

    this.reannounceTimer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        const peers = await this.announceToTrackers();
        this.knownPeers = peers;
        this.refillPeerPool();
      } catch (err) {
        this.emit("error", err as Error);
      }
      this.scheduleReannounce(intervalSec);
    }, intervalSec * 1000);
  }

  /** If we have fewer active connections than maxConcurrentPeers, try connecting to more known peers. */
  private refillPeerPool(): void {
    if (this.stopped) return;
    if (this.sessions.size >= this.config.maxConcurrentPeers) return;

    const slotsAvailable = this.config.maxConcurrentPeers - this.sessions.size;
    const candidates = this.knownPeers.filter(
      (p) => !this.sessions.has(`${p.ip}:${p.port}`)
    );

    for (const peer of candidates.slice(0, slotsAvailable)) {
      this.spawnPeerSession(peer);
    }
  }

  private async announceToTrackers(): Promise<TrackerPeer[]> {
    const left = this.torrent.totalLength;

    for (const tier of this.torrent.announceList) {
      for (const url of tier) {
        try {
          const params = {
            infoHash: this.torrent.infoHash,
            peerId: this.myPeerId,
            port: this.config.listenPort,
            uploaded: 0,
            downloaded: 0,
            left,
            event: "started" as const,
          };

          console.log(`[Tracker] Attempting to announce to: ${url}`);

          const response = url.startsWith("udp://")
            ? await announceUdp(url, params)
            : await announceHttp(url, params);

          console.log(`[Tracker] Announce successful, got ${response.peers.length} peers`);

          if (response.peers.length > 0) {
            return response.peers;
          }
        } catch (err) {
          // This tracker failed or is unreachable — try the next one (BEP 12 fallback)
          console.log(`[Tracker] Announce failed: ${(err as Error).message}`);
          this.emit("error", err as Error);
          continue;
        }
      }
    }

    throw new Error("DownloadSession: no trackers returned any peers");
  }

  private spawnPeerSession(peer: TrackerPeer): void {
    const peerKey = `${peer.ip}:${peer.port}`;
    if (this.sessions.has(peerKey)) return; // already connected to this peer

    const session = new PeerSession(
      peer.ip,
      peer.port,
      this.torrent.infoHash,
      this.myPeerId,
      this.config.maxPendingBlockRequestsPerPeer
    );
    this.sessions.set(peerKey, session);

    session.on("pieceAvailable", (pieceIndex) => {
      this.scheduler.recordPeerHasPiece(peerKey, pieceIndex);
      this.tryAssignWork(session);
    });

    session.on("ready", () => {
      this.emit("peerConnected", peerKey);
      this.tryAssignWork(session);
    });

    session.on("pieceComplete", (pieceIndex, data) => {
      void this.handlePieceComplete(session, pieceIndex, data);
    });

    session.on("error", () => {
      // Per-peer failure is isolated — just drop this one peer, swarm continues.
      this.cleanupPeer(peerKey);
    });

    session.on("close", () => {
      this.cleanupPeer(peerKey);
    });

    session.connect(this.config.peerConnectTimeoutMs);
  }

  private async handlePieceComplete(session: PeerSession, pieceIndex: number, data: Buffer): Promise<void> {
    const expectedHash = this.torrent.pieceHashes[pieceIndex]!;

    let isValid: boolean;
    try {
      isValid = await this.verifier.verifyPiece(pieceIndex, data, expectedHash);
    } catch (err) {
      this.emit("error", err as Error);
      this.scheduler.markFailed(pieceIndex);
      this.tryAssignWork(session);
      return;
    }

    if (!isValid) {
      // Corrupt or malicious data — discard and re-request from someone else
      this.scheduler.markFailed(pieceIndex);
      this.tryAssignWork(session);
      return;
    }

    await this.diskWriter.writePiece(pieceIndex, data);
    this.scheduler.markComplete(pieceIndex);
    this.progress.recordPieceComplete(data.length);
    this.emit("progress", this.progress.getSnapshot());

    if (this.scheduler.isComplete()) {
      await this.finish();
      return;
    }

    this.tryAssignWork(session);
  }

  private tryAssignWork(session: PeerSession): void {
    if (this.stopped || session.isBusy || session.isChoked) return;

    const pieceIndex = this.scheduler.selectNextPiece(session.peerKey);
    if (pieceIndex === null) return; // nothing this peer has that we still need

    const pieceLength = this.pieceLengthFor(pieceIndex);
    session.startPiece(pieceIndex, pieceLength);
  }

  private pieceLengthFor(pieceIndex: number): number {
    const isLastPiece = pieceIndex === this.torrent.pieceHashes.length - 1;
    if (!isLastPiece) return this.torrent.pieceLength;

    const remainder = this.torrent.totalLength % this.torrent.pieceLength;
    return remainder === 0 ? this.torrent.pieceLength : remainder;
  }

  private cleanupPeer(peerKey: string): void {
    this.scheduler.removePeer(peerKey);
    this.sessions.delete(peerKey);
    this.emit("peerDisconnected", peerKey);
    this.refillPeerPool();
  }

  private async finish(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reannounceTimer) clearTimeout(this.reannounceTimer);

    for (const session of this.sessions.values()) {
      session.destroy();
    }
    await this.diskWriter.close();
    await this.verifier.shutdown();

    this.emit("complete");
    this.completionResolve?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reannounceTimer) clearTimeout(this.reannounceTimer);
    for (const session of this.sessions.values()) {
      session.destroy();
    }
    await this.diskWriter.close();
    await this.verifier.shutdown();
  }
}

export declare interface DownloadSession {
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): this;
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
}