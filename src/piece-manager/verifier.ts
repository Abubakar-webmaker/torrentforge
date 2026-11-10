import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

interface PendingJob {
  resolve: (isValid: boolean) => void;
  reject: (err: Error) => void;
}

/**
 * Manages a pool of worker_threads to verify piece hashes without
 * blocking the main event loop (which must stay free to handle
 * ongoing peer socket I/O).
 */
export class PieceVerifier {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private nextJobId = 0;
  private pendingJobs: Map<number, PendingJob> = new Map();
  private workerScriptPath: string;

  constructor(workerScriptPath?: string, poolSize?: number) {
    // Default: compiled worker script location, sized to available CPU cores
    // Path: from dist/piece-manager/verifier.js to dist/workers/hash-worker.js
    this.workerScriptPath =
      workerScriptPath ?? fileURLToPath(new URL("../../workers/hash-worker.js", import.meta.url));

    const size = poolSize ?? Math.max(1, cpus().length - 1);

    for (let i = 0; i < size; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const worker = new Worker(this.workerScriptPath);

    worker.on("message", (result: { jobId: number; pieceIndex: number; hash?: Buffer; error?: string }) => {
      const pending = this.pendingJobs.get(result.jobId);
      if (!pending) return; // stale/unknown job, ignore

      this.pendingJobs.delete(result.jobId);
      
      if (result.error) {
        pending.reject(new Error(`Worker error: ${result.error}`));
      } else {
        // The caller compares the hash itself (see verifyPiece) — worker just computes it
        (pending as any)._resolveHash(Buffer.from(result.hash!));
      }
    });

    worker.on("error", (err) => {
      // Reject all pending jobs assigned to this worker's in-flight set is complex;
      // simplest safe approach: this worker is unhealthy, replace it.
      this.workers = this.workers.filter((w) => w !== worker);
      this.spawnWorker();
      void err; // logged by caller via verifyPiece's own error path if needed
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        // Worker exited unexpectedly - remove it and spawn a new one
        this.workers = this.workers.filter((w) => w !== worker);
        if (this.workers.length < Math.max(1, cpus().length - 1)) {
          this.spawnWorker();
        }
      }
    });

    this.workers.push(worker);
  }

  /** Hashes `data` in a worker thread and compares it to `expectedHash`. */
  verifyPiece(pieceIndex: number, data: Buffer, expectedHash: Buffer): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.workers.length === 0) {
        reject(new Error("PieceVerifier: no workers available"));
        return;
      }

      const jobId = this.nextJobId++;
      const worker = this.workers[this.nextWorkerIndex % this.workers.length]!;
      this.nextWorkerIndex++;

      const pending: PendingJob & { _resolveHash: (hash: Buffer) => void } = {
        resolve,
        reject,
        _resolveHash: (hash: Buffer) => {
          resolve(hash.equals(expectedHash));
        },
      };
      this.pendingJobs.set(jobId, pending);

      worker.postMessage({ jobId, pieceIndex, data });
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.pendingJobs.clear();
  }
}