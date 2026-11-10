import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type Socket as ServerSocket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { PeerConnection } from "./peer-connection.js";
import { buildHandshake } from "./handshake.js";
import { encodeMessage, MessageType } from "./wire-protocol.js";

let server: Server;
let serverPort: number;
let serverSocket: ServerSocket | null = null;

const infoHash = createHash("sha1").update("test-torrent").digest();
const clientPeerId = randomBytes(20);
const fakePeerServerId = randomBytes(20);

beforeEach(async () => {
  serverSocket = null;
  server = createServer((sock) => {
    serverSocket = sock;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  serverPort = typeof addr === "object" && addr ? addr.port : 0;
});

afterEach(() => {
  server.close();
});

function waitForServerSocket(): Promise<ServerSocket> {
  return new Promise((resolve) => {
    const check = () => {
      if (serverSocket) resolve(serverSocket);
      else setTimeout(check, 5);
    };
    check();
  });
}

describe("PeerConnection", () => {
  it("completes handshake with a well-behaved peer", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);

    const handshakePromise = new Promise<Buffer>((resolve) => {
      conn.on("handshake", (peerId) => resolve(peerId));
    });

    conn.connect();

    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));

    const receivedPeerId = await handshakePromise;
    expect(receivedPeerId.equals(fakePeerServerId)).toBe(true);

    conn.destroy();
  });

  it("rejects a peer that sends a mismatched info_hash", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);

    const errorPromise = new Promise<Error>((resolve) => {
      conn.on("error", (err) => resolve(err));
    });

    conn.connect();

    const srvSocket = await waitForServerSocket();
    const wrongInfoHash = createHash("sha1").update("different-torrent").digest();
    srvSocket.write(buildHandshake(wrongInfoHash, fakePeerServerId));

    const err = await errorPromise;
    expect(err.message).toMatch(/mismatched info_hash/);

    conn.destroy();
  });

  it("parses wire messages received after handshake", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);
    const messages: any[] = [];
    conn.on("message", (msg) => messages.push(msg));

    const handshakeDone = new Promise<void>((resolve) => conn.on("handshake", () => resolve()));
    conn.connect();

    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));
    await handshakeDone;

    srvSocket.write(encodeMessage({ type: MessageType.Unchoke }));
    srvSocket.write(encodeMessage({ type: MessageType.Have, pieceIndex: 7 }));

    await new Promise((r) => setTimeout(r, 50)); // let the socket data events flush

    expect(messages).toEqual([
      { type: MessageType.Unchoke },
      { type: MessageType.Have, pieceIndex: 7 },
    ]);
    expect(conn.peerChoking).toBe(false);

    conn.destroy();
  });

  it("handles a message split across multiple TCP packets", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);
    const messages: any[] = [];
    conn.on("message", (msg) => messages.push(msg));

    const handshakeDone = new Promise<void>((resolve) => conn.on("handshake", () => resolve()));
    conn.connect();

    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));
    await handshakeDone;

    const fullMsg = encodeMessage({ type: MessageType.Have, pieceIndex: 99 });
    // Split the message into two chunks sent separately, simulating real TCP fragmentation
    srvSocket.write(fullMsg.subarray(0, 3));
    await new Promise((r) => setTimeout(r, 20));
    srvSocket.write(fullMsg.subarray(3));
    await new Promise((r) => setTimeout(r, 20));

    expect(messages).toEqual([{ type: MessageType.Have, pieceIndex: 99 }]);

    conn.destroy();
  });

  it("send() updates amChoking/amInterested state correctly", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);
    const handshakeDone = new Promise<void>((resolve) => conn.on("handshake", () => resolve()));
    conn.connect();

    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));
    await handshakeDone;

    expect(conn.amInterested).toBe(false);
    conn.send({ type: MessageType.Interested });
    expect(conn.amInterested).toBe(true);

    expect(conn.amChoking).toBe(true);
    conn.send({ type: MessageType.Unchoke });
    expect(conn.amChoking).toBe(false);

    conn.destroy();
  });

  it("throws when send() is called after the connection is destroyed", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);
    const handshakeDone = new Promise<void>((resolve) => conn.on("handshake", () => resolve()));
    conn.connect();

    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));
    await handshakeDone;

    conn.destroy();
    await new Promise((r) => setTimeout(r, 20));

    expect(() => conn.send({ type: MessageType.Interested })).toThrow(/connection .* is closed/);
  });

  it("emits 'close' when the remote peer disconnects", async () => {
    const conn = new PeerConnection("127.0.0.1", serverPort, infoHash, clientPeerId);
    const closePromise = new Promise<void>((resolve) => conn.on("close", () => resolve()));

    conn.connect();
    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, fakePeerServerId));
    await new Promise((r) => setTimeout(r, 30));

    srvSocket.destroy(); // remote side disconnects
    await closePromise; // should resolve without hanging
  });
});