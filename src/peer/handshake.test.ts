import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildHandshake, parseHandshake, HANDSHAKE_LENGTH } from "./handshake.js";

describe("buildHandshake / parseHandshake", () => {
  const infoHash = createHash("sha1").update("test").digest();
  const peerId = randomBytes(20);

  it("builds a handshake of the correct length", () => {
    const hs = buildHandshake(infoHash, peerId);
    expect(hs.length).toBe(HANDSHAKE_LENGTH);
    expect(hs.length).toBe(68);
  });

  it("round-trips correctly through parseHandshake", () => {
    const hs = buildHandshake(infoHash, peerId);
    const parsed = parseHandshake(hs);

    expect(parsed.infoHash.equals(infoHash)).toBe(true);
    expect(parsed.peerId.equals(peerId)).toBe(true);
    expect(parsed.reservedBytes.length).toBe(8);
    expect(parsed.reservedBytes.equals(Buffer.alloc(8))).toBe(true);
  });

  it("rejects infoHash that isn't 20 bytes", () => {
    expect(() => buildHandshake(Buffer.alloc(10), peerId)).toThrow(/20 bytes/);
  });

  it("rejects peerId that isn't 20 bytes", () => {
    expect(() => buildHandshake(infoHash, Buffer.alloc(5))).toThrow(/20 bytes/);
  });

  it("rejects a buffer of the wrong total length", () => {
    expect(() => parseHandshake(Buffer.alloc(50))).toThrow(/expected 68 bytes/);
  });

  it("rejects a mismatched protocol string", () => {
    const hs = buildHandshake(infoHash, peerId);
    hs.write("WrongProtocolXXXXXX", 1, "ascii"); // corrupt the protocol string
    expect(() => parseHandshake(hs)).toThrow(/protocol string/);
  });
});