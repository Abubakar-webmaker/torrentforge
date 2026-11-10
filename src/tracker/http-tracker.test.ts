import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { BencodeEncoder } from "../bencode/encoder.js";
import { announceHttp } from "./http-tracker.js";
import { getPeerId } from "./peer-id.js";

let server: Server;
let serverUrl: string;
let lastReceivedQuery: URLSearchParams | null = null;
let lastReceivedUrl: string | null = null;
let mockResponseBuilder: () => Buffer = () => Buffer.alloc(0);

beforeAll(async () => {
  server = createServer((req, res) => {
    lastReceivedUrl = req.url!;
    const url = new URL(req.url!, "http://localhost");
    lastReceivedQuery = url.searchParams;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(mockResponseBuilder());
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address && typeof address === "object") {
    serverUrl = `http://127.0.0.1:${address.port}/announce`;
  } else {
    throw new Error("Failed to start test server");
  }
});

afterAll(() => {
  server.close();
});

function buildCompactTrackerResponse(opts: {
  interval: number;
  peers: { ip: [number, number, number, number]; port: number }[];
  complete?: number;
  incomplete?: number;
}): Buffer {
  const peerBuf = Buffer.concat(
    opts.peers.map((p) => {
      const b = Buffer.alloc(6);
      b[0] = p.ip[0]; b[1] = p.ip[1]; b[2] = p.ip[2]; b[3] = p.ip[3];
      b.writeUInt16BE(p.port, 4);
      return b;
    })
  );

  const dict: Record<string, any> = {
    interval: opts.interval,
    peers: peerBuf,
  };
  if (opts.complete !== undefined) dict.complete = opts.complete;
  if (opts.incomplete !== undefined) dict.incomplete = opts.incomplete;

  return BencodeEncoder.encode(dict);
}

describe("announceHttp", () => {
  const infoHash = createHash("sha1").update("test-info").digest();
  const peerId = getPeerId();

  it("parses a compact peer list response correctly", async () => {
    mockResponseBuilder = () =>
      buildCompactTrackerResponse({
        interval: 1800,
        peers: [
          { ip: [192, 168, 1, 1], port: 6881 },
          { ip: [10, 0, 0, 5], port: 51413 },
        ],
        complete: 5,
        incomplete: 2,
      });

    const result = await announceHttp(serverUrl, {
      infoHash,
      peerId,
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: 1000,
    });

    expect(result.interval).toBe(1800);
    expect(result.peers).toEqual([
      { ip: "192.168.1.1", port: 6881 },
      { ip: "10.0.0.5", port: 51413 },
    ]);
    expect(result.seeders).toBe(5);
    expect(result.leechers).toBe(2);
  });

  it("sends info_hash and peer_id as correctly percent-encoded raw bytes", async () => {
    // Instead of relying on the HTTP layer, directly test that buildAnnounceUrl creates correct percent-encoding
    // This is more reliable than trying to extract and decode from a mock server response
    
    // Create a simple test to verify the encoding/decoding cycle
    mockResponseBuilder = () => buildCompactTrackerResponse({ interval: 60, peers: [] });

    const testHash = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]); // Mix of bytes including non-ASCII
    const testId = Buffer.from([0x7E, 0x7F, 0x80, 0xFE, 0xFF]); // More bytes

    await announceHttp(serverUrl, {
      infoHash: testHash,
      peerId: testId,
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: 1000,
    });

    expect(lastReceivedUrl).not.toBeNull();
    
    // Extract the query string from the raw URL
    const queryString = lastReceivedUrl!.split("?")[1];
    
    // Manually parse the query string without URLSearchParams
    const decodePercentEncoded = (encoded: string): Buffer => {
      const bytes: number[] = [];
      for (let i = 0; i < encoded.length; i++) {
        if (encoded[i] === "%") {
          const hex = encoded.substring(i + 1, i + 3);
          bytes.push(parseInt(hex, 16));
          i += 2;
        } else {
          bytes.push(encoded.charCodeAt(i));
        }
      }
      return Buffer.from(bytes);
    };
    
    // Parse query string manually
    let infoHashParam = "";
    let peerIdParam = "";
    
    for (const param of queryString.split("&")) {
      const [key, ...valueParts] = param.split("=");
      const value = valueParts.join("="); // Handle values with = in them
      if (key === "info_hash") infoHashParam = value;
      if (key === "peer_id") peerIdParam = value;
    }
    
    const receivedInfoHash = decodePercentEncoded(infoHashParam);
    const receivedPeerId = decodePercentEncoded(peerIdParam);

    expect(receivedInfoHash.equals(testHash)).toBe(true);
    expect(receivedPeerId.equals(testId)).toBe(true);
  });

  it("includes the event parameter when provided", async () => {
    mockResponseBuilder = () => buildCompactTrackerResponse({ interval: 60, peers: [] });

    await announceHttp(serverUrl, {
      infoHash,
      peerId,
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: 0,
      event: "completed",
    });

    expect(lastReceivedQuery!.get("event")).toBe("completed");
  });

  it("throws when tracker returns a failure reason", async () => {
    mockResponseBuilder = () =>
      BencodeEncoder.encode({ "failure reason": Buffer.from("torrent not registered") });

    await expect(
      announceHttp(serverUrl, {
        infoHash,
        peerId,
        port: 6881,
        uploaded: 0,
        downloaded: 0,
        left: 1000,
      })
    ).rejects.toThrow(/torrent not registered/);
  });

  it("throws on malformed compact peers buffer", async () => {
    mockResponseBuilder = () =>
      BencodeEncoder.encode({ interval: 60, peers: Buffer.from([1, 2, 3]) }); // not multiple of 6

    await expect(
      announceHttp(serverUrl, {
        infoHash,
        peerId,
        port: 6881,
        uploaded: 0,
        downloaded: 0,
        left: 1000,
      })
    ).rejects.toThrow(/multiple of 6/);
  });
});

describe("getPeerId", () => {
  it("returns a 20-byte buffer starting with the client prefix", () => {
    const id = getPeerId();
    expect(id.length).toBe(20);
    expect(id.subarray(0, 8).toString("ascii")).toBe("-TF0001-");
  });

  it("returns the same cached id on repeated calls", () => {
    expect(getPeerId().equals(getPeerId())).toBe(true);
  });
});