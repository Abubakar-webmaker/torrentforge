import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskWriter } from "./disk-writer.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "torrentforge-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("DiskWriter — single-file torrent", () => {
  it("writes a piece to the correct offset in a single file", async () => {
    const writer = new DiskWriter(testDir, [{ path: ["output.bin"], length: 20 }], 10);
    await writer.init();

    await writer.writePiece(0, Buffer.from("0123456789"));
    await writer.writePiece(1, Buffer.from("abcdefghij"));
    await writer.close();

    const content = await readFile(join(testDir, "output.bin"));
    expect(content.toString()).toBe("0123456789abcdefghij");
  });

  it("writes pieces out of order correctly", async () => {
    const writer = new DiskWriter(testDir, [{ path: ["output.bin"], length: 20 }], 10);
    await writer.init();

    // piece 1 arrives before piece 0 — common in real downloads (rarest-first)
    await writer.writePiece(1, Buffer.from("abcdefghij"));
    await writer.writePiece(0, Buffer.from("0123456789"));
    await writer.close();

    const content = await readFile(join(testDir, "output.bin"));
    expect(content.toString()).toBe("0123456789abcdefghij");
  });

  it("handles the final, shorter-than-pieceLength piece correctly", async () => {
    const writer = new DiskWriter(testDir, [{ path: ["output.bin"], length: 15 }], 10);
    await writer.init();

    await writer.writePiece(0, Buffer.from("0123456789")); // full piece, 10 bytes
    await writer.writePiece(1, Buffer.from("abcde"));       // final piece, only 5 bytes
    await writer.close();

    const content = await readFile(join(testDir, "output.bin"));
    expect(content.toString()).toBe("0123456789abcde");
  });
});

describe("DiskWriter — multi-file torrent", () => {
  it("splits a single piece correctly across two files", async () => {
    // a.txt = 6 bytes (offset 0-5), b.txt = 6 bytes (offset 6-11)
    // piece length = 4 -> piece 0 = bytes[0-3] (all in a.txt)
    //                     piece 1 = bytes[4-7] (bytes 4-5 in a.txt, bytes 6-7 in b.txt)
    //                     piece 2 = bytes[8-11] (all in b.txt)
    const writer = new DiskWriter(
      testDir,
      [
        { path: ["a.txt"], length: 6 },
        { path: ["b.txt"], length: 6 },
      ],
      4
    );
    await writer.init();

    await writer.writePiece(0, Buffer.from("AAAA"));
    await writer.writePiece(1, Buffer.from("AABB")); // last 2 bytes of a.txt + first 2 of b.txt
    await writer.writePiece(2, Buffer.from("BBBB"));
    await writer.close();

    const aContent = await readFile(join(testDir, "a.txt"));
    const bContent = await readFile(join(testDir, "b.txt"));

    expect(aContent.toString()).toBe("AAAAAA"); // 6 bytes
    expect(bContent.toString()).toBe("BBBBBB"); // 6 bytes
  });

  it("creates nested directories for files with subfolder paths", async () => {
    const writer = new DiskWriter(
      testDir,
      [{ path: ["sub", "folder", "file.txt"], length: 5 }],
      5
    );
    await writer.init();
    await writer.writePiece(0, Buffer.from("hello"));
    await writer.close();

    const content = await readFile(join(testDir, "sub", "folder", "file.txt"));
    expect(content.toString()).toBe("hello");
  });

  it("writes correctly when a piece covers three files", async () => {
    // a=2 bytes, b=2 bytes, c=2 bytes, pieceLength=6 -> 1 single piece spans all 3
    const writer = new DiskWriter(
      testDir,
      [
        { path: ["a.txt"], length: 2 },
        { path: ["b.txt"], length: 2 },
        { path: ["c.txt"], length: 2 },
      ],
      6
    );
    await writer.init();
    await writer.writePiece(0, Buffer.from("AABBCC"));
    await writer.close();

    expect((await readFile(join(testDir, "a.txt"))).toString()).toBe("AA");
    expect((await readFile(join(testDir, "b.txt"))).toString()).toBe("BB");
    expect((await readFile(join(testDir, "c.txt"))).toString()).toBe("CC");
  });
});