import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";

if (!parentPort) {
  throw new Error("hash-worker.ts must be run as a worker_thread, not directly");
}

interface HashJob {
  jobId: number;
  pieceIndex: number;
  data: Buffer;
}

interface HashResult {
  jobId: number;
  pieceIndex: number;
  hash: Buffer;
}

parentPort.on("message", (job: HashJob) => {
  const hash = createHash("sha1").update(job.data).digest();

  const result: HashResult = {
    jobId: job.jobId,
    pieceIndex: job.pieceIndex,
    hash,
  };

  parentPort!.postMessage(result);
});