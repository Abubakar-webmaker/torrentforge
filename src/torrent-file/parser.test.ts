import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { BencodeEncoder } from "../bencode/encoder.js";
import { parseTorrentFile } from "./parser.js";

function buildFakeTorrent(infoOverrides: Record<string, any> = {}) {
  const info = {
    name: Buffer.from("testfile.txt"),
    "piece length": 16384,
    pieces: Buffer.concat([
      createHash("sha1").update("piece0").digest(),
      createHash("sha1").update("piece1").digest(),
    ]),
    length: 32768,
    ...infoOverrides,
  };

  const torrentObj = {
    announce: Buffer.from("http://tracker.example.com/announce"),
    info,
  };

  return { torrentObj, info };
}

describe("parseTorrentFile — single-file torrents", () => {
  it("parses basic fields correctly", () => {
    const { torrentObj } = buildFakeTorrent();
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    expect(parsed.announce).toBe("http://tracker.example.com/announce");
    expect(parsed.name).toBe("testfile.txt");
    expect(parsed.pieceLength).toBe(16384);
    expect(parsed.totalLength).toBe(32768);
    expect(parsed.isMultiFile).toBe(false);
    expect(parsed.files).toEqual([{ path: ["testfile.txt"], length: 32768 }]);
  });

  it("splits 'pieces' buffer into correct 20-byte hashes", () => {
    const { torrentObj } = buildFakeTorrent();
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    expect(parsed.pieceHashes.length).toBe(2);
    expect(parsed.pieceHashes[0]!.length).toBe(20);
    expect(parsed.pieceHashes[0]!.equals(createHash("sha1").update("piece0").digest())).toBe(true);
    expect(parsed.pieceHashes[1]!.equals(createHash("sha1").update("piece1").digest())).toBe(true);
  });

  it("computes info-hash as SHA1 of the exact bencoded info dict", () => {
    const { torrentObj, info } = buildFakeTorrent();
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    // independently compute expected hash the same way a real tracker would
    const expectedHash = createHash("sha1").update(BencodeEncoder.encode(info)).digest();
    expect(parsed.infoHash.equals(expectedHash)).toBe(true);
    expect(parsed.infoHash.length).toBe(20);
  });

  it("rejects 'pieces' length that isn't a multiple of 20", () => {
    const { torrentObj } = buildFakeTorrent({ pieces: Buffer.from("tooshort") });
    const raw = BencodeEncoder.encode(torrentObj);
    expect(() => parseTorrentFile(raw)).toThrow(/multiple of 20/);
  });
});

describe("parseTorrentFile — multi-file torrents", () => {
  it("parses multiple files and computes totalLength as their sum", () => {
    const info = {
      name: Buffer.from("my-folder"),
      "piece length": 16384,
      pieces: createHash("sha1").update("piece0").digest(),
      files: [
        { length: 1000, path: [Buffer.from("a.txt")] },
        { length: 2000, path: [Buffer.from("sub"), Buffer.from("b.txt")] },
      ],
    };
    const torrentObj = {
      announce: Buffer.from("http://tracker.example.com/announce"),
      info,
    };
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    expect(parsed.isMultiFile).toBe(true);
    expect(parsed.totalLength).toBe(3000);
    expect(parsed.files).toEqual([
      { path: ["a.txt"], length: 1000 },
      { path: ["sub", "b.txt"], length: 2000 },
    ]);
  });
});

describe("parseTorrentFile — announce-list (BEP 12)", () => {
  it("parses multi-tier tracker list when present", () => {
    const { info } = buildFakeTorrent();
    const torrentObj = {
      announce: Buffer.from("http://primary.example.com/announce"),
      "announce-list": [
        [Buffer.from("http://primary.example.com/announce")],
        [Buffer.from("http://backup1.example.com/announce"), Buffer.from("http://backup2.example.com/announce")],
      ],
      info,
    };
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    expect(parsed.announceList).toEqual([
      ["http://primary.example.com/announce"],
      ["http://backup1.example.com/announce", "http://backup2.example.com/announce"],
    ]);
  });

  it("falls back to [[announce]] when announce-list is absent", () => {
    const { torrentObj } = buildFakeTorrent();
    const raw = BencodeEncoder.encode(torrentObj);
    const parsed = parseTorrentFile(raw);

    expect(parsed.announceList).toEqual([["http://tracker.example.com/announce"]]);
  });
});

describe("parseTorrentFile — malformed input", () => {
  it("throws when 'info' dict is missing", () => {
    const raw = BencodeEncoder.encode({ announce: Buffer.from("http://x.com") });
    expect(() => parseTorrentFile(raw)).toThrow();
  });

  it("throws when 'announce' is not a string", () => {
    const { info } = buildFakeTorrent();
    const raw = BencodeEncoder.encode({ announce: 42, info });
    expect(() => parseTorrentFile(raw)).toThrow(/announce/);
  });
});