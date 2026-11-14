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
  private jobWorkerMap: Map<number, Worker> = new Map(); // Track which worker each job was sent to
  private workerScriptPath: string;

  constructor(workerScriptPath?: string, poolSize?: number) {
    // Default: compiled worker script location, sized to available CPU cores
    if (!workerScriptPath) {
      const currentFilePath = fileURLToPath(import.meta.url);
      const parts = currentFilePath.split(/[\\/]/);
      
      // When running from dist (compiled): dist/src/piece-manager/verifier.js
      // When running from src (in tests): src/piece-manager/verifier.ts
      // We need either dist/workers/hash-worker.js (production) or dist/workers/hash-worker.js (tests - must compile)
      
      let targetPath: string;
      const distIdx = parts.lastIndexOf("dist");
      
      if (distIdx !== -1) {
        // Running from compiled dist folder
        targetPath = [...parts.slice(0, distIdx + 1), "workers", "hash-worker.js"].join("/");
      } else {
        // Running from src (tests via tsx): find project root and go to dist/workers
        const srcIdx = parts.lastIndexOf("src");
        if (srcIdx !== -1) {
          // Replace src with dist, then add workers path
          const pathToRoot = parts.slice(0, srcIdx);
          targetPath = [...pathToRoot, "dist", "workers", "hash-worker.js"].join("/");
        } else {
          // Fallback: use relative from current location
          targetPath = fileURLToPath(new URL("../../workers/hash-worker.js", import.meta.url));
        }
      }
      
      this.workerScriptPath = targetPath;
    } else {
      this.workerScriptPath = workerScriptPath;
    }

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
      this.jobWorkerMap.delete(result.jobId); // Clean up tracking
      
      if (result.error) {
        pending.reject(new Error(`Worker error: ${result.error}`));
      } else {
        // The caller compares the hash itself (see verifyPiece) — worker just computes it
        (pending as any)._resolveHash(Buffer.from(result.hash!));
      }
    });

    worker.on("error", (err: unknown) => {
      // Find and reject all pending jobs sent to this crashed worker
      const jobsForThisWorker: number[] = [];
      for (const [jobId, assignedWorker] of this.jobWorkerMap) {
        if (assignedWorker === worker) {
          jobsForThisWorker.push(jobId);
        }
      }
      
      const errorMessage = err instanceof Error ? err.message : String(err);
      for (const jobId of jobsForThisWorker) {
        const pending = this.pendingJobs.get(jobId);
        if (pending) {
          pending.reject(new Error(`Worker crashed: ${errorMessage}`));
          this.pendingJobs.delete(jobId);
        }
        this.jobWorkerMap.delete(jobId);
      }

      // Remove the crashed worker and spawn a replacement
      this.workers = this.workers.filter((w) => w !== worker);
      this.spawnWorker();
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
      this.jobWorkerMap.set(jobId, worker); // Track which worker this job was sent to

      worker.postMessage({ jobId, pieceIndex, data });
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.pendingJobs.clear();
    this.jobWorkerMap.clear();
  }
}