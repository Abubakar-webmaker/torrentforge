import { describe, it, expect } from "vitest";
import { encodeMessage, decodeMessage, MessageType } from "./wire-protocol.js";

describe("encodeMessage / decodeMessage round-trip", () => {
  it("keepalive", () => {
    const encoded = encodeMessage({ type: "keepalive" });
    expect(encoded.length).toBe(4);
    expect(encoded.readUInt32BE(0)).toBe(0);

    const decoded = decodeMessage(encoded);
    expect(decoded?.message).toEqual({ type: "keepalive" });
    expect(decoded?.bytesConsumed).toBe(4);
  });

  it("choke / unchoke / interested / not-interested (no payload)", () => {
    for (const message of [
      { type: MessageType.Choke },
      { type: MessageType.Unchoke },
      { type: MessageType.Interested },
      { type: MessageType.NotInterested },
    ] as const) {
      const encoded = encodeMessage(message);
      const decoded = decodeMessage(encoded);
      expect(decoded?.message).toEqual(message);
      expect(decoded?.bytesConsumed).toBe(encoded.length);
    }
  });

  it("have", () => {
    const msg = { type: MessageType.Have as const, pieceIndex: 42 };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded?.message).toEqual(msg);
  });

  it("bitfield", () => {
    const bitfield = Buffer.from([0xff, 0x0f, 0x80]);
    const msg = { type: MessageType.Bitfield as const, bitfield };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded?.message.type).toBe(MessageType.Bitfield);
    if (decoded?.message.type === MessageType.Bitfield) {
      expect(decoded.message.bitfield.equals(bitfield)).toBe(true);
    }
  });

  it("request", () => {
    const msg = { type: MessageType.Request as const, pieceIndex: 3, begin: 16384, length: 16384 };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded?.message).toEqual(msg);
  });

  it("piece", () => {
    const block = randomBlock(1024);
    const msg = { type: MessageType.Piece as const, pieceIndex: 5, begin: 0, block };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded?.message.type).toBe(MessageType.Piece);
    if (decoded?.message.type === MessageType.Piece) {
      expect(decoded.message.pieceIndex).toBe(5);
      expect(decoded.message.begin).toBe(0);
      expect(decoded.message.block.equals(block)).toBe(true);
    }
  });

  it("cancel", () => {
    const msg = { type: MessageType.Cancel as const, pieceIndex: 2, begin: 0, length: 16384 };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded?.message).toEqual(msg);
  });
});

describe("decodeMessage — partial/streaming buffer handling", () => {
  it("returns null when buffer has fewer than 4 bytes (no length prefix yet)", () => {
    expect(decodeMessage(Buffer.alloc(2))).toBeNull();
  });

  it("returns null when length prefix says more data is needed", () => {
    const msg = { type: MessageType.Have as const, pieceIndex: 1 };
    const full = encodeMessage(msg);
    const partial = full.subarray(0, full.length - 1); // missing last byte
    expect(decodeMessage(partial)).toBeNull();
  });

  it("correctly decodes the first message and reports bytesConsumed when extra trailing data exists", () => {
    const msg1 = encodeMessage({ type: MessageType.Choke });
    const msg2 = encodeMessage({ type: MessageType.Unchoke });
    const combined = Buffer.concat([msg1, msg2]);

    const first = decodeMessage(combined);
    expect(first?.message).toEqual({ type: MessageType.Choke });
    expect(first?.bytesConsumed).toBe(msg1.length);

    const remaining = combined.subarray(first!.bytesConsumed);
    const second = decodeMessage(remaining);
    expect(second?.message).toEqual({ type: MessageType.Unchoke });
  });
});

describe("decodeMessage — malformed input", () => {
  it("throws on unknown message id", () => {
    const buf = Buffer.alloc(5);
    buf.writeUInt32BE(1, 0);
    buf.writeUInt8(99, 4); // invalid id
    expect(() => decodeMessage(buf)).toThrow(/unknown message id/);
  });

  it("throws on malformed 'have' payload length", () => {
    const buf = Buffer.alloc(6);
    buf.writeUInt32BE(2, 0);
    buf.writeUInt8(MessageType.Have, 4);
    buf.writeUInt8(0, 5); // only 1 byte payload instead of 4
    expect(() => decodeMessage(buf)).toThrow(/malformed 'have'/);
  });
});

function randomBlock(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}