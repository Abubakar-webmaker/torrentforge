import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";

/**
 * Worker thread that computes SHA1 hashes for piece data.
 * Receives: { jobId, pieceIndex, data }
 * Sends: { jobId, pieceIndex, hash }
 */
if (!parentPort) {
  throw new Error("hash-worker.ts must be run as a worker_thread, not directly");
}

parentPort.on("message", (msg: { jobId: number; pieceIndex: number; data: Buffer }) => {
  try {
    const hash = createHash("sha1").update(msg.data).digest();
    parentPort!.postMessage({
      jobId: msg.jobId,
      pieceIndex: msg.pieceIndex,
      hash,
    });
  } catch (err) {
    parentPort!.postMessage({
      jobId: msg.jobId,
      error: (err as Error).message,
    });
  }
});
