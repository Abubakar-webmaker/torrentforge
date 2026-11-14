import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import { createHash } from "node:crypto";
import { announceUdp } from "./udp-tracker.js";
import { getPeerId } from "./peer-id.js";

let server: Socket;
let serverPort: number;
const FAKE_CONNECTION_ID = 123456789n;

beforeEach(async () => {
  server = createSocket("udp4");

  server.on("message", (msg, rinfo) => {
    const action = msg.readUInt32BE(8);
    const transactionId = msg.subarray(12, 16);

    if (action === 0) {
      // CONNECT request -> respond with a fake connection_id
      const response = Buffer.alloc(16);
      response.writeUInt32BE(0, 0); // action = connect
      transactionId.copy(response, 4);
      response.writeBigUInt64BE(FAKE_CONNECTION_ID, 8);
      server.send(response, rinfo.port, rinfo.address);
    } else if (action === 1) {
      // ANNOUNCE request -> respond with fake peers
      const response = Buffer.alloc(20 + 12); // header + 2 peers
      response.writeUInt32BE(1, 0); // action = announce
      transactionId.copy(response, 4);
      response.writeUInt32BE(1800, 8); // interval
      response.writeUInt32BE(3, 12); // leechers
      response.writeUInt32BE(7, 16); // seeders

      response[20] = 192; response[21] = 168; response[22] = 0; response[23] = 1;
      response.writeUInt16BE(6881, 24);

      response[26] = 10; response[27] = 0; response[28] = 0; response[29] = 9;
      response.writeUInt16BE(51413, 30);

      server.send(response, rinfo.port, rinfo.address);
    }
  });

  await new Promise<void>((resolve) => {
    server.bind(0, "127.0.0.1", () => {
      const addr = server.address();
      serverPort = typeof addr === "object" ? addr.port : 0;
      resolve();
    });
  });
});

afterEach(() => {
  server.close();
});

describe("announceUdp", () => {
  const infoHash = createHash("sha1").update("test-info").digest();
  const peerId = getPeerId();

  it("completes connect + announce handshake and parses peers", async () => {
    const result = await announceUdp(`udp://127.0.0.1:${serverPort}`, {
      infoHash,
      peerId,
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: 5000,
    });

    expect(result.interval).toBe(1800);
    expect(result.seeders).toBe(7);
    expect(result.leechers).toBe(3);
    expect(result.peers).toEqual([
      { ip: "192.168.0.1", port: 6881 },
      { ip: "10.0.0.9", port: 51413 },
    ]);
  });

  it("rejects non-udp:// URLs", async () => {
    await expect(
      announceUdp("http://127.0.0.1:1234", {
        infoHash,
        peerId,
        port: 6881,
        uploaded: 0,
        downloaded: 0,
        left: 0,
      })
    ).rejects.toThrow(/udp:\/\//);
  });

  it("times out and throws if server never responds", async () => {
    const deadServer = createSocket("udp4");
    await new Promise<void>((resolve) => deadServer.bind(0, "127.0.0.1", resolve));
    const addr = deadServer.address();
    const deadPort = typeof addr === "object" ? addr.port : 0;
    // server bound but intentionally has no 'message' handler -> silence -> timeout

    await expect(
      announceUdp(`udp://127.0.0.1:${deadPort}`, {
        infoHash,
        peerId,
        port: 6881,
        uploaded: 0,
        downloaded: 0,
        left: 0,
      })
    ).rejects.toThrow(/timed out/);

    deadServer.close();
  }, 60000); // allow time for retries
});