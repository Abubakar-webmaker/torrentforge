import { describe, it, expect } from "vitest";
import { PieceScheduler, PieceStatus } from "./scheduler.js";

describe("PieceScheduler", () => {
  it("starts with all pieces missing", () => {
    const sched = new PieceScheduler(5);
    for (let i = 0; i < 5; i++) {
      expect(sched.getStatus(i)).toBe(PieceStatus.Missing);
    }
    expect(sched.isComplete()).toBe(false);
  });

  it("selects the rarest piece a peer has, among missing pieces", () => {
    const sched = new PieceScheduler(3);

    // piece 0: peerA, peerB, peerC have it (availability 3)
    // piece 1: only peerA has it (availability 1) -> rarest
    // piece 2: peerA, peerB have it (availability 2)
    sched.recordPeerHasPiece("peerA", 0);
    sched.recordPeerHasPiece("peerB", 0);
    sched.recordPeerHasPiece("peerC", 0);

    sched.recordPeerHasPiece("peerA", 1);

    sched.recordPeerHasPiece("peerA", 2);
    sched.recordPeerHasPiece("peerB", 2);

    const chosen = sched.selectNextPiece("peerA");
    expect(chosen).toBe(1); // rarest piece that peerA actually has
  });

  it("marks a selected piece as in_progress, assigned to that peer", () => {
    const sched = new PieceScheduler(2);
    sched.recordPeerHasPiece("peerA", 0);

    const chosen = sched.selectNextPiece("peerA");
    expect(chosen).toBe(0);
    expect(sched.getStatus(0)).toBe(PieceStatus.InProgress);
  });

  it("does not re-select a piece that's already in_progress or complete", () => {
    const sched = new PieceScheduler(1);
    sched.recordPeerHasPiece("peerA", 0);
    sched.recordPeerHasPiece("peerB", 0);

    const first = sched.selectNextPiece("peerA");
    expect(first).toBe(0);

    // peerB also has piece 0, but it's already in_progress -> nothing to select
    const second = sched.selectNextPiece("peerB");
    expect(second).toBeNull();
  });

  it("returns null when peer has no pieces we need", () => {
    const sched = new PieceScheduler(2);
    const chosen = sched.selectNextPiece("unknownPeer");
    expect(chosen).toBeNull();
  });

  it("markComplete updates status and completedCount/isComplete", () => {
    const sched = new PieceScheduler(2);
    sched.recordPeerHasPiece("peerA", 0);
    sched.selectNextPiece("peerA");
    sched.markComplete(0);

    expect(sched.getStatus(0)).toBe(PieceStatus.Have);
    expect(sched.completedCount()).toBe(1);
    expect(sched.isComplete()).toBe(false);

    sched.recordPeerHasPiece("peerA", 1);
    sched.selectNextPiece("peerA");
    sched.markComplete(1);
    expect(sched.isComplete()).toBe(true);
  });

  it("markFailed makes a piece requestable again", () => {
    const sched = new PieceScheduler(1);
    sched.recordPeerHasPiece("peerA", 0);
    sched.selectNextPiece("peerA");
    expect(sched.getStatus(0)).toBe(PieceStatus.InProgress);

    sched.markFailed(0);
    expect(sched.getStatus(0)).toBe(PieceStatus.Missing);

    const reSelected = sched.selectNextPiece("peerA");
    expect(reSelected).toBe(0);
  });

  it("removePeer decrements availability and frees their in-progress pieces", () => {
    const sched = new PieceScheduler(2);
    sched.recordPeerHasPiece("peerA", 0);
    sched.recordPeerHasPiece("peerB", 0);
    sched.selectNextPiece("peerA"); // piece 0 now in_progress, assigned to peerA

    sched.removePeer("peerA");

    // piece 0 should be missing again since peerA (who was fetching it) left
    expect(sched.getStatus(0)).toBe(PieceStatus.Missing);

    // peerB can now pick it up
    const chosen = sched.selectNextPiece("peerB");
    expect(chosen).toBe(0);
  });

  it("throws on out-of-range piece index operations", () => {
    const sched = new PieceScheduler(3);
    expect(() => sched.getStatus(5)).toThrow(/out of range/);
    expect(() => sched.markComplete(-1)).toThrow(/out of range/);
    expect(() => sched.recordPeerHasPiece("peerA", 10)).toThrow(/out of range/);
  });
});