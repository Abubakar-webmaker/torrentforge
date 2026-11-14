import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import type { TrackerAnnounceParams, TrackerResponse, TrackerPeer } from "./types.js";

const PROTOCOL_MAGIC = 0x41727101980n; // fixed constant from BEP 15 spec
const ACTION_CONNECT = 0;
const ACTION_ANNOUNCE = 1;
const ACTION_ERROR = 3;

const EVENT_CODES: Record<string, number> = {
  none: 0,
  completed: 1,
  started: 2,
  stopped: 3,
};

interface UdpTarget {
  host: string;
  port: number;
}

function parseUdpUrl(trackerUrl: string): UdpTarget {
  const url = new URL(trackerUrl);
  if (url.protocol !== "udp:") {
    throw new Error(`UDP tracker: expected udp:// URL, got ${trackerUrl}`);
  }
  return { host: url.hostname, port: Number(url.port) || 80 };
}

/** Sends one UDP packet and waits for a response, with timeout + retry (BEP 15 recommends exponential backoff). */
function sendAndReceive(
  socket: ReturnType<typeof createSocket>,
  target: UdpTarget,
  packet: Buffer,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("UDP tracker: request timed out"));
    }, timeoutMs);

    function onMessage(msg: Buffer) {
      cleanup();
      resolve(msg);
    }
    function onError(err: Error) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      socket.removeListener("error", onError);
    }

    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.send(packet, target.port, target.host);
  });
}

async function connect(
  socket: ReturnType<typeof createSocket>,
  target: UdpTarget,
  signal?: AbortSignal
): Promise<bigint> {
  const transactionId = randomBytes(4);

  const packet = Buffer.alloc(16);
  packet.writeBigUInt64BE(PROTOCOL_MAGIC, 0);
  packet.writeUInt32BE(ACTION_CONNECT, 8);
  transactionId.copy(packet, 12);

  const response = await withRetry(() => sendAndReceive(socket, target, packet, 15000), signal);

  if (response.length < 16) {
    throw new Error("UDP tracker: connect response too short");
  }
  const action = response.readUInt32BE(0);
  const respTransactionId = response.subarray(4, 8);

  if (!respTransactionId.equals(transactionId)) {
    throw new Error("UDP tracker: transaction ID mismatch on connect");
  }
  if (action === ACTION_ERROR) {
    throw new Error(`UDP tracker: connect failed — ${response.subarray(8).toString("utf8")}`);
  }
  if (action !== ACTION_CONNECT) {
    throw new Error(`UDP tracker: unexpected action ${action} on connect`);
  }

  return response.readBigUInt64BE(8); // connection_id
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new Error("UDP tracker: aborted");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function announceUdp(
  trackerUrl: string,
  params: TrackerAnnounceParams,
  signal?: AbortSignal
): Promise<TrackerResponse> {
  const target = parseUdpUrl(trackerUrl);
  const socket = createSocket("udp4");

  try {
    const connectionId = await connect(socket, target, signal);

    const transactionId = randomBytes(4);
    const packet = Buffer.alloc(98);

    packet.writeBigUInt64BE(connectionId, 0);
    packet.writeUInt32BE(ACTION_ANNOUNCE, 8);
    transactionId.copy(packet, 12);
    params.infoHash.copy(packet, 16);
    params.peerId.copy(packet, 36);
    packet.writeBigUInt64BE(BigInt(params.downloaded), 56);
    packet.writeBigUInt64BE(BigInt(params.left), 64);
    packet.writeBigUInt64BE(BigInt(params.uploaded), 72);
    packet.writeUInt32BE(EVENT_CODES[params.event ?? "none"], 80);
    packet.writeUInt32BE(0, 84); // IP address = 0 (let tracker determine it)
    randomBytes(4).copy(packet, 88); // key (randomized per spec recommendation)
    packet.writeInt32BE(-1, 92); // num_want = -1 (default amount)
    packet.writeUInt16BE(params.port, 96);

    const response = await withRetry(() => sendAndReceive(socket, target, packet, 15000), signal);

    if (response.length < 20) {
      throw new Error("UDP tracker: announce response too short");
    }
    const action = response.readUInt32BE(0);
    const respTransactionId = response.subarray(4, 8);

    if (!respTransactionId.equals(transactionId)) {
      throw new Error("UDP tracker: transaction ID mismatch on announce");
    }
    if (action === ACTION_ERROR) {
      throw new Error(`UDP tracker: announce failed — ${response.subarray(8).toString("utf8")}`);
    }
    if (action !== ACTION_ANNOUNCE) {
      throw new Error(`UDP tracker: unexpected action ${action} on announce`);
    }

    const interval = response.readUInt32BE(8);
    const leechers = response.readUInt32BE(12);
    const seeders = response.readUInt32BE(16);

    const peersBuf = response.subarray(20);
    if (peersBuf.length % 6 !== 0) {
      throw new Error("UDP tracker: peers data length is not a multiple of 6");
    }
    const peers: TrackerPeer[] = [];
    for (let i = 0; i < peersBuf.length; i += 6) {
      const ip = `${peersBuf[i]}.${peersBuf[i + 1]}.${peersBuf[i + 2]}.${peersBuf[i + 3]}`;
      const port = peersBuf.readUInt16BE(i + 4);
      peers.push({ ip, port });
    }

    return { interval, peers, seeders, leechers };
  } finally {
    socket.close();
  }
}