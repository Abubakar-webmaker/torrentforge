import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type Socket as ServerSocket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { PeerSession } from "./peer-session.js";
import { buildHandshake } from "../peer/handshake.js";
import { encodeMessage, MessageType } from "../peer/wire-protocol.js";

let server: Server;
let serverPort: number;
let serverSocket: ServerSocket | null = null;

const infoHash = createHash("sha1").update("test-torrent").digest();
const myPeerId = randomBytes(20);
const remotePeerId = randomBytes(20);

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
  vi.useRealTimers();
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

describe("PeerSession — stall detection", () => {
  it("emits error and destroys connection if no data arrives within blockTimeoutMs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const session = new PeerSession("127.0.0.1", serverPort, infoHash, myPeerId, 5, 200); // 200ms timeout for test speed
    const errorPromise = new Promise<Error>((resolve) => session.on("error", resolve));

    session.connect();
    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, remotePeerId));
    srvSocket.write(encodeMessage({ type: MessageType.Unchoke }));

    await vi.advanceTimersByTimeAsync(10); // let handshake/unchoke process

    session.startPiece(0, 32768); // starts the stall timer

    await vi.advanceTimersByTimeAsync(250); // exceed the 200ms timeout, no piece data sent

    const err = await errorPromise;
    expect(err.message).toMatch(/stalled/);
  });

  it("resets the stall timer when a piece block IS received in time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const session = new PeerSession("127.0.0.1", serverPort, infoHash, myPeerId, 5, 300);
    let errored = false;
    session.on("error", () => { errored = true; });

    session.connect();
    const srvSocket = await waitForServerSocket();
    srvSocket.write(buildHandshake(infoHash, remotePeerId));
    srvSocket.write(encodeMessage({ type: MessageType.Unchoke }));
    await vi.advanceTimersByTimeAsync(10);

    session.startPiece(0, 16384); // single block, 16384 bytes

    // Send the block BEFORE the 300ms timeout fires
    await vi.advanceTimersByTimeAsync(150);
    srvSocket.write(
      encodeMessage({ type: MessageType.Piece, pieceIndex: 0, begin: 0, block: Buffer.alloc(16384) })
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(errored).toBe(false); // timer was reset, no stall error

    session.destroy();
  });
});