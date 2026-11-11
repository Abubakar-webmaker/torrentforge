import { EventEmitter } from "node:events";
import { PeerConnection } from "../peer/peer-connection.js";
import { MessageType, type PeerMessage } from "../peer/wire-protocol.js";
import { PieceAssembler, getBlockRequestsForPiece, BLOCK_SIZE, type BlockRequest } from "../piece-manager/piece-assembler.js";

export interface PeerSessionEvents {
  ready: [];                                  // handshake done, bitfield processed, ready to be scheduled
  pieceAvailable: [pieceIndex: number];       // peer has a piece (from bitfield or 'have')
  pieceComplete: [pieceIndex: number, data: Buffer];
  error: [err: Error];
  close: [];
}

/**
 * Drives ONE peer's download conversation: handshake -> interested ->
 * wait for unchoke -> request blocks for whichever piece it's been
 * assigned -> assemble -> emit 'pieceComplete'. The orchestrator decides
 * WHICH piece this peer should fetch; this class only knows HOW to fetch it.
 */
export class PeerSession extends EventEmitter {
  private conn: PeerConnection;
  private currentAssembler: PieceAssembler | null = null;
  private pendingRequests: BlockRequest[] = [];
  private inFlightCount = 0;
  private readonly maxPendingRequests: number;
  public readonly peerKey: string; // "ip:port" — used as the scheduler's peerId
  private stallTimer: NodeJS.Timeout | null = null;
  private readonly blockTimeoutMs: number;

  constructor(
    ip: string,
    port: number,
    infoHash: Buffer,
    myPeerId: Buffer,
    maxPendingRequests = 5,
    blockTimeoutMs = 30_000
  ) {
    super();
    this.peerKey = `${ip}:${port}`;
    this.maxPendingRequests = maxPendingRequests;
    this.blockTimeoutMs = blockTimeoutMs;
    this.conn = new PeerConnection(ip, port, infoHash, myPeerId);
    this.wireEvents();
  }

  private wireEvents(): void {
    this.conn.on("handshake", () => {
      // Tell the peer we're interested right away — simplest viable strategy
      this.conn.send({ type: MessageType.Interested });
    });

    this.conn.on("message", (msg: PeerMessage) => this.handleMessage(msg));
    this.conn.on("error", (err) => this.emit("error", err));
    this.conn.on("close", () => this.emit("close"));
  }

  connect(timeoutMs?: number): void {
    this.conn.connect(timeoutMs);
  }

  private handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case MessageType.Bitfield: {
        for (let i = 0; i < msg.bitfield.length * 8; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitOffset = i % 8;
          const has = (msg.bitfield[byteIndex]! & (0x80 >> bitOffset)) !== 0;
          if (has) this.emit("pieceAvailable", i);
        }
        this.emit("ready");
        break;
      }

      case MessageType.Have:
        this.emit("pieceAvailable", msg.pieceIndex);
        break;

      case MessageType.Unchoke:
        this.fillRequestPipeline();
        break;

      case MessageType.Choke:
        // Peer choked us — any pending requests are effectively dead.
        // Caller (orchestrator) should reassign this peer's current piece.
        break;

      case MessageType.Piece: {
        this.resetStallTimer();
        this.inFlightCount--;
        if (this.currentAssembler && this.currentAssembler.pieceIndex === msg.pieceIndex) {
          const isComplete = this.currentAssembler.addBlock(msg.begin, msg.block);
          if (isComplete) {
            const data = this.currentAssembler.getData();
            const pieceIndex = this.currentAssembler.pieceIndex;
            this.currentAssembler = null;
            this.pendingRequests = [];
            this.emit("pieceComplete", pieceIndex, data);
          } else {
            this.fillRequestPipeline();
          }
        }
        break;
      }

      default:
        break; // Interested/NotInterested/Cancel — not needed for a leecher-only client
    }
  }

  /** Called by the orchestrator once it has picked a piece for this peer via the scheduler. */
  startPiece(pieceIndex: number, pieceLength: number): void {
    this.currentAssembler = new PieceAssembler(pieceIndex, pieceLength);
    this.pendingRequests = getBlockRequestsForPiece(pieceIndex, pieceLength);
    this.inFlightCount = 0;

    if (!this.conn.peerChoking) {
      this.fillRequestPipeline();
    }
    this.resetStallTimer();
    // if peer is choking us, fillRequestPipeline() will run once we get 'unchoke'
  }

  private resetStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.emit("error", new Error(`PeerSession ${this.peerKey}: stalled (no data for ${this.blockTimeoutMs}ms)`));
      this.destroy();
    }, this.blockTimeoutMs);
  }

  private fillRequestPipeline(): void {
    while (this.inFlightCount < this.maxPendingRequests && this.pendingRequests.length > 0) {
      const req = this.pendingRequests.shift()!;
      this.conn.send({
        type: MessageType.Request,
        pieceIndex: req.pieceIndex,
        begin: req.begin,
        length: req.length,
      });
      this.inFlightCount++;
    }
  }

  get isChoked(): boolean {
    return this.conn.peerChoking;
  }

  get isBusy(): boolean {
    return this.currentAssembler !== null;
  }

  destroy(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.conn.destroy();
  }
}

export declare interface PeerSession {
  on<K extends keyof PeerSessionEvents>(event: K, listener: (...args: PeerSessionEvents[K]) => void): this;
  emit<K extends keyof PeerSessionEvents>(event: K, ...args: PeerSessionEvents[K]): boolean;
}