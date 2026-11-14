import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { PieceVerifier } from "./verifier.js";

let verifier: PieceVerifier;

beforeAll(() => {
  verifier = new PieceVerifier(undefined, 2); // small pool for tests
});

afterAll(async () => {
  await verifier.shutdown();
});

describe("PieceVerifier", () => {
  it("returns true when hash matches", async () => {
    const data = Buffer.from("hello world");
    const expectedHash = createHash("sha1").update(data).digest();

    const isValid = await verifier.verifyPiece(0, data, expectedHash);
    expect(isValid).toBe(true);
  });

  it("returns false when hash doesn't match", async () => {
    const data = Buffer.from("hello world");
    const wrongHash = createHash("sha1").update("different data").digest();

    const isValid = await verifier.verifyPiece(0, data, wrongHash);
    expect(isValid).toBe(false);
  });

  it("handles multiple concurrent verifications correctly (no cross-contamination)", async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => {
      const data = Buffer.from(`piece-data-${i}`);
      const hash = createHash("sha1").update(data).digest();
      return { pieceIndex: i, data, hash };
    });

    const results = await Promise.all(
      jobs.map((job) => verifier.verifyPiece(job.pieceIndex, job.data, job.hash))
    );

    expect(results.every((r) => r === true)).toBe(true);
  });

  it("correctly identifies a mismatch among many concurrent correct verifications", async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => {
      const data = Buffer.from(`piece-${i}`);
      const correctHash = createHash("sha1").update(data).digest();
      // Sabotage job #5 with a wrong hash on purpose
      const hash = i === 5 ? createHash("sha1").update("corrupted").digest() : correctHash;
      return { pieceIndex: i, data, hash };
    });

    const results = await Promise.all(
      jobs.map((job) => verifier.verifyPiece(job.pieceIndex, job.data, job.hash))
    );

    results.forEach((result, i) => {
      expect(result).toBe(i !== 5);
    });
  });
});