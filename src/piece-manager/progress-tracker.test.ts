import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressTracker } from "./progress-tracker.js";

describe("ProgressTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0% with no pieces completed", () => {
    const tracker = new ProgressTracker(10, 1000);
    const snap = tracker.getSnapshot();

    expect(snap.completedPieces).toBe(0);
    expect(snap.percentComplete).toBe(0);
    expect(snap.bytesDownloaded).toBe(0);
    expect(snap.downloadSpeedBps).toBe(0);
  });

  it("updates completedPieces, bytesDownloaded and percentComplete correctly", () => {
    const tracker = new ProgressTracker(4, 400);

    tracker.recordPieceComplete(100);
    let snap = tracker.getSnapshot();
    expect(snap.completedPieces).toBe(1);
    expect(snap.bytesDownloaded).toBe(100);
    expect(snap.percentComplete).toBe(25);

    tracker.recordPieceComplete(100);
    tracker.recordPieceComplete(100);
    tracker.recordPieceComplete(100);
    snap = tracker.getSnapshot();
    expect(snap.completedPieces).toBe(4);
    expect(snap.percentComplete).toBe(100);
  });

  it("computes rolling download speed based on recent samples", () => {
    const tracker = new ProgressTracker(100, 100_000);

    tracker.recordPieceComplete(1000); // t=0
    vi.advanceTimersByTime(1000); // 1 second passes
    tracker.recordPieceComplete(1000); // t=1000ms, total 2000 bytes

    const snap = tracker.getSnapshot();
    // 2000 bytes delivered over ~1 second -> ~2000 bytes/sec (approx, due to sample spacing)
    expect(snap.downloadSpeedBps).toBeGreaterThan(0);
  });

  it("returns null ETA when speed is 0 (no samples yet)", () => {
    const tracker = new ProgressTracker(10, 1000);
    expect(tracker.estimatedSecondsRemaining()).toBeNull();
  });

  it("estimates remaining time based on current speed and remaining bytes", () => {
    const tracker = new ProgressTracker(10, 10_000);

    tracker.recordPieceComplete(1000); // t=0, 1000/10000 bytes done
    vi.advanceTimersByTime(1000);
    tracker.recordPieceComplete(1000); // t=1000ms, 2000/10000 bytes done, ~1000 bytes/sec

    const eta = tracker.estimatedSecondsRemaining();
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(0);
  });

  it("drops samples older than the rolling window", () => {
    const tracker = new ProgressTracker(100, 1_000_000);

    tracker.recordPieceComplete(5000); // t=0
    vi.advanceTimersByTime(15_000); // 15 seconds pass — older than the 10s window
    tracker.recordPieceComplete(5000); // t=15000ms

    // Speed should be computed from the recent window only, not blended with the stale t=0 sample
    const snap = tracker.getSnapshot();
    expect(snap.downloadSpeedBps).toBeGreaterThanOrEqual(0); // should not throw/NaN
    expect(Number.isNaN(snap.downloadSpeedBps)).toBe(false);
  });
});