import { Socket, connect as tcpConnect } from "node:net";
import { EventEmitter } from "node:events";
import { buildHandshake, parseHandshake, HANDSHAKE_LENGTH } from "./handshake.js";
import { decodeMessage, encodeMessage, MessageType, type PeerMessage } from "./wire-protocol.js";

export interface PeerConnectionEvents {
  connect: [];
  handshake: [peerId: Buffer];
  message: [msg: PeerMessage];
  error: [err: Error];
  close: [];
}

/**
 * Wraps a single TCP connection to one peer.
 * Handles: connecting, handshake exchange, and parsing the continuous
 * byte stream into discrete wire-protocol messages.
 *
 * Emits events — callers use .on("message", ...) etc. This isolates
 * one peer's failures from the rest of the swarm (an error here just
 * emits "error" and/or "close", it never crashes the process).
 */
export class PeerConnection extends EventEmitter {
  private socket: Socket | null = null;
  private recvBuffer: Buffer = Buffer.alloc(0);
  private handshakeComplete = false;
  private readonly ip: string;
  private readonly port: number;
  private readonly infoHash: Buffer;
  private readonly peerId: Buffer;

  public remotePeerId: Buffer | null = null;
  public amChoking = true;
  public amInterested = false;
  public peerChoking = true;
  public peerInterested = false;

  constructor(ip: string, port: number, infoHash: Buffer, peerId: Buffer) {
    super();
    this.ip = ip;
    this.port = port;
    this.infoHash = infoHash;
    this.peerId = peerId;
  }

  connect(timeoutMs = 10000): void {
    const socket = tcpConnect({ host: this.ip, port: this.port });
    this.socket = socket;

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.setTimeout(0); // disable connect-timeout once connected
      this.emit("connect");
      // Send handshake immediately upon TCP connect
      socket.write(buildHandshake(this.infoHash, this.peerId));
    });

    socket.on("data", (chunk: Buffer) => {
      this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
      this.processBuffer();
    });

    socket.on("timeout", () => {
      this.emit("error", new Error(`Peer ${this.ip}:${this.port} connection timed out`));
      socket.destroy();
    });

    socket.on("error", (err: Error) => {
      this.emit("error", err);
    });

    socket.on("close", () => {
      this.emit("close");
    });
  }

  private processBuffer(): void {
    // Handshake comes first and has a fixed, non-length-prefixed format,
    // so it must be parsed differently from subsequent wire messages.
    if (!this.handshakeComplete) {
      if (this.recvBuffer.length < HANDSHAKE_LENGTH) return; // wait for more data

      const handshakeBuf = this.recvBuffer.subarray(0, HANDSHAKE_LENGTH);
      this.recvBuffer = this.recvBuffer.subarray(HANDSHAKE_LENGTH);

      let parsed;
      try {
        parsed = parseHandshake(handshakeBuf);
      } catch (err) {
        this.emit("error", err as Error);
        this.socket?.destroy();
        return;
      }

      if (!parsed.infoHash.equals(this.infoHash)) {
        this.emit("error", new Error(`Peer ${this.ip}:${this.port} sent mismatched info_hash`));
        this.socket?.destroy();
        return;
      }

      this.remotePeerId = parsed.peerId;
      this.handshakeComplete = true;
      this.emit("handshake", parsed.peerId);
      // fall through — there might already be wire messages in the buffer
    }

    // Decode as many complete wire messages as are currently available
    while (true) {
      let result;
      try {
        result = decodeMessage(this.recvBuffer);
      } catch (err) {
        this.emit("error", err as Error);
        this.socket?.destroy();
        return;
      }
      if (result === null) break; // need more bytes from the socket

      this.recvBuffer = this.recvBuffer.subarray(result.bytesConsumed);
      this.handleMessage(result.message);
    }
  }

  private handleMessage(msg: PeerMessage): void {
    if (msg.type === MessageType.Choke) this.peerChoking = true;
    if (msg.type === MessageType.Unchoke) this.peerChoking = false;
    if (msg.type === MessageType.Interested) this.peerInterested = true;
    if (msg.type === MessageType.NotInterested) this.peerInterested = false;

    this.emit("message", msg);
  }

  send(msg: PeerMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error(`Cannot send — connection to ${this.ip}:${this.port} is closed`);
    }
    this.socket.write(encodeMessage(msg));

    if (msg.type === MessageType.Choke) this.amChoking = true;
    if (msg.type === MessageType.Unchoke) this.amChoking = false;
    if (msg.type === MessageType.Interested) this.amInterested = true;
    if (msg.type === MessageType.NotInterested) this.amInterested = false;
  }

  destroy(): void {
    this.socket?.destroy();
  }
}

export declare interface PeerConnection {
  on<K extends keyof PeerConnectionEvents>(
    event: K,
    listener: (...args: PeerConnectionEvents[K]) => void
  ): this;
  emit<K extends keyof PeerConnectionEvents>(event: K, ...args: PeerConnectionEvents[K]): boolean;
}