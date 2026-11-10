export interface ProgressSnapshot {
  totalPieces: number;
  completedPieces: number;
  percentComplete: number;
  bytesDownloaded: number;
  totalBytes: number;
  downloadSpeedBps: number; // bytes per second, measured over a rolling window
}

/**
 * Tracks download progress and computes a rolling-average download speed
 * (not just a simple cumulative average, which would be misleading —
 * e.g. a fast start followed by a slow patch should show the *recent*
 * slow speed, not an optimistic blended average).
 */
export class ProgressTracker {
  private completedPieces = 0;
  private bytesDownloaded = 0;

  // rolling window of (timestamp, bytesAtThatTime) samples, last ~10 seconds
  private samples: { time: number; bytes: number }[] = [];
  private readonly windowMs = 10_000;

  constructor(
    private readonly totalPieces: number,
    private readonly totalBytes: number
  ) {}

  recordPieceComplete(pieceSize: number): void {
    this.completedPieces++;
    this.bytesDownloaded += pieceSize;
    this.recordSample();
  }

  private recordSample(): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes: this.bytesDownloaded });

    // Drop samples older than the rolling window
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && this.samples[0]!.time < cutoff) {
      this.samples.shift();
    }
  }

  getSnapshot(): ProgressSnapshot {
    const downloadSpeedBps = this.computeRollingSpeed();

    return {
      totalPieces: this.totalPieces,
      completedPieces: this.completedPieces,
      percentComplete: this.totalPieces === 0 ? 0 : (this.completedPieces / this.totalPieces) * 100,
      bytesDownloaded: this.bytesDownloaded,
      totalBytes: this.totalBytes,
      downloadSpeedBps,
    };
  }

  private computeRollingSpeed(): number {
    if (this.samples.length < 2) return 0;

    const oldest = this.samples[0]!;
    const newest = this.samples[this.samples.length - 1]!;

    const elapsedSeconds = (newest.time - oldest.time) / 1000;
    if (elapsedSeconds <= 0) return 0;

    const bytesDelta = newest.bytes - oldest.bytes;
    return bytesDelta / elapsedSeconds;
  }

  estimatedSecondsRemaining(): number | null {
    const speed = this.computeRollingSpeed();
    if (speed <= 0) return null;

    const remainingBytes = this.totalBytes - this.bytesDownloaded;
    return remainingBytes / speed;
  }
}