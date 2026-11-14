import { describe, it, expect } from "vitest";
import { BencodeDecoder } from "./decoder.js";
import { BencodeEncoder } from "./encoder.js";

describe("BencodeDecoder", () => {
  it("decodes integers", () => {
    expect(BencodeDecoder.decode(Buffer.from("i42e"))).toBe(42);
    expect(BencodeDecoder.decode(Buffer.from("i-42e"))).toBe(-42);
    expect(BencodeDecoder.decode(Buffer.from("i0e"))).toBe(0);
  });

  it("rejects malformed integers", () => {
    expect(() => BencodeDecoder.decode(Buffer.from("i04e"))).toThrow();
    expect(() => BencodeDecoder.decode(Buffer.from("iabce"))).toThrow();
  });

  it("decodes strings as Buffers", () => {
    const result = BencodeDecoder.decode(Buffer.from("4:spam")) as Buffer;
    expect(result.toString("utf8")).toBe("spam");
  });

  it("decodes lists", () => {
    const result = BencodeDecoder.decode(Buffer.from("l4:spami42ee")) as any[];
    expect(result.length).toBe(2);
    expect((result[0] as Buffer).toString()).toBe("spam");
    expect(result[1]).toBe(42);
  });

  it("decodes dictionaries", () => {
    const result = BencodeDecoder.decode(Buffer.from("d3:cow3:moo3:ham4:eggse")) as any;
    expect(result.cow.toString()).toBe("moo");
    expect(result.ham.toString()).toBe("eggs");
  });

  it("rejects unsorted dictionary keys", () => {
    // "z" before "a" = invalid order
    expect(() => BencodeDecoder.decode(Buffer.from("d1:zi1e1:ai2ee"))).toThrow();
  });

  it("rejects trailing garbage", () => {
    expect(() => BencodeDecoder.decode(Buffer.from("i42eGARBAGE"))).toThrow();
  });
});

describe("BencodeEncoder", () => {
  it("encodes integers", () => {
    expect(BencodeEncoder.encode(42).toString()).toBe("i42e");
    expect(BencodeEncoder.encode(-7).toString()).toBe("i-7e");
  });

  it("encodes strings", () => {
    expect(BencodeEncoder.encode(Buffer.from("spam")).toString()).toBe("4:spam");
  });

  it("encodes lists", () => {
    const encoded = BencodeEncoder.encode([Buffer.from("spam"), 42]);
    expect(encoded.toString()).toBe("l4:spami42ee");
  });

  it("encodes dictionaries in sorted key order", () => {
    const encoded = BencodeEncoder.encode({
      zebra: 1,
      apple: 2,
    });
    // "apple" sorts before "zebra" regardless of insertion order
    expect(encoded.toString()).toBe("d5:applei2e5:zebrai1ee");
  });
});

describe("Round-trip (decode -> encode -> decode)", () => {
  it("preserves real torrent-like data", () => {
    const object = {
      announce: Buffer.from("http://tracker.com/"),
      info: {
        length: 1024,
        name: Buffer.from("test.file"),
        "piece length": 256
      }
    };
    
    const encoded = BencodeEncoder.encode(object);
    const decoded = BencodeDecoder.decode(encoded);
    const reEncoded = BencodeEncoder.encode(decoded);
    const reDecoded = BencodeDecoder.decode(reEncoded);
    
    expect(reDecoded).toEqual(decoded);
  });

  it("handles nested lists and dicts together", () => {
    const original: any = {
      files: [
        { length: 100, path: Buffer.from("a.txt") },
        { length: 200, path: Buffer.from("b.txt") },
      ],
    };
    const encoded = BencodeEncoder.encode(original);
    const decoded = BencodeDecoder.decode(encoded);
    expect(decoded).toEqual(original);
  });
});