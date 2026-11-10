export enum PieceStatus {
  Missing = "missing",       // not yet requested
  InProgress = "in_progress", // currently being downloaded from a peer
  Have = "have",               // downloaded + verified
}

interface PieceState {
  status: PieceStatus;
  assignedPeerId?: string; // which peer is currently fetching this (if in_progress)
}

/**
 * Tracks which pieces exist, which peers have which pieces, and decides
 * what to request next using rarest-first selection.
 */
export class PieceScheduler {
  private pieceStates: PieceState[];
  private availability: number[]; // availability[i] = how many known peers have piece i
  private peerBitfields: Map<string, Set<number>> = new Map(); // peerId -> set of piece indices they have

  constructor(public readonly numPieces: number) {
    this.pieceStates = Array.from({ length: numPieces }, () => ({ status: PieceStatus.Missing }));
    this.availability = Array(numPieces).fill(0);
  }

  /** Call when a peer sends its bitfield or a 'have' message. */
  recordPeerHasPiece(peerId: string, pieceIndex: number): void {
    this.assertValidIndex(pieceIndex);

    let set = this.peerBitfields.get(peerId);
    if (!set) {
      set = new Set();
      this.peerBitfields.set(peerId, set);
    }

    if (!set.has(pieceIndex)) {
      set.add(pieceIndex);
      this.availability[pieceIndex]!++;
    }
  }

  /** Call when a peer disconnects, so availability counts stay accurate. */
  removePeer(peerId: string): void {
    const set = this.peerBitfields.get(peerId);
    if (!set) return;

    for (const pieceIndex of set) {
      this.availability[pieceIndex]!--;
    }
    this.peerBitfields.delete(peerId);

    // Free up any piece this peer was downloading, so another peer can take it
    for (const state of this.pieceStates) {
      if (state.assignedPeerId === peerId) {
        state.status = PieceStatus.Missing;
        state.assignedPeerId = undefined;
      }
    }
  }

  /**
   * Picks the next piece to request from a given peer, using rarest-first
   * among pieces that peer actually has and that aren't already
   * in-progress/complete. Returns null if nothing is available to request.
   */
  selectNextPiece(peerId: string): number | null {
    const peerPieces = this.peerBitfields.get(peerId);
    if (!peerPieces || peerPieces.size === 0) return null;

    let best: number | null = null;
    let bestAvailability = Infinity;

    for (const pieceIndex of peerPieces) {
      const state = this.pieceStates[pieceIndex]!;
      if (state.status !== PieceStatus.Missing) continue;

      const avail = this.availability[pieceIndex]!;
      if (avail < bestAvailability) {
        bestAvailability = avail;
        best = pieceIndex;
      }
    }

    if (best !== null) {
      this.pieceStates[best]!.status = PieceStatus.InProgress;
      this.pieceStates[best]!.assignedPeerId = peerId;
    }

    return best;
  }

  markComplete(pieceIndex: number): void {
    this.assertValidIndex(pieceIndex);
    this.pieceStates[pieceIndex]!.status = PieceStatus.Have;
    this.pieceStates[pieceIndex]!.assignedPeerId = undefined;
  }

  /** Call if a piece download fails (timeout, hash mismatch) — makes it requestable again. */
  markFailed(pieceIndex: number): void {
    this.assertValidIndex(pieceIndex);
    this.pieceStates[pieceIndex]!.status = PieceStatus.Missing;
    this.pieceStates[pieceIndex]!.assignedPeerId = undefined;
  }

  getStatus(pieceIndex: number): PieceStatus {
    this.assertValidIndex(pieceIndex);
    return this.pieceStates[pieceIndex]!.status;
  }

  isComplete(): boolean {
    return this.pieceStates.every((s) => s.status === PieceStatus.Have);
  }

  completedCount(): number {
    return this.pieceStates.filter((s) => s.status === PieceStatus.Have).length;
  }

  private assertValidIndex(pieceIndex: number): void {
    if (pieceIndex < 0 || pieceIndex >= this.numPieces) {
      throw new Error(`PieceScheduler: piece index ${pieceIndex} out of range`);
    }
  }
}