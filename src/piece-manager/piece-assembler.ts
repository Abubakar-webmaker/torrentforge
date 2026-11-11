export const BLOCK_SIZE = 16384; // 16KB — standard BitTorrent block size

export interface BlockRequest {
  pieceIndex: number;
  begin: number;
  length: number;
}

/** Splits one piece into the sequence of block requests needed to fetch it. */
export function getBlockRequestsForPiece(pieceIndex: number, pieceLength: number): BlockRequest[] {
  const requests: BlockRequest[] = [];
  let offset = 0;

  while (offset < pieceLength) {
    const length = Math.min(BLOCK_SIZE, pieceLength - offset);
    requests.push({ pieceIndex, begin: offset, length });
    offset += length;
  }

  return requests;
}

/**
 * Accumulates incoming blocks for ONE in-progress piece until it's complete.
 * One instance per piece currently being downloaded.
 */
export class PieceAssembler {
  private buffer: Buffer;
  private received: boolean[];
  private receivedCount = 0;

  constructor(
    public readonly pieceIndex: number,
    public readonly pieceLength: number
  ) {
    this.buffer = Buffer.alloc(pieceLength);
    const numBlocks = Math.ceil(pieceLength / BLOCK_SIZE);
    this.received = Array(numBlocks).fill(false);
  }

  /** Returns true if this call completed the piece (all blocks now received). */
  addBlock(begin: number, data: Buffer): boolean {
    const blockIndex = begin / BLOCK_SIZE;
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= this.received.length) {
      throw new Error(`PieceAssembler: invalid block offset ${begin} for piece ${this.pieceIndex}`);
    }

    if (begin + data.length > this.pieceLength) {
      throw new Error(`PieceAssembler: block exceeds piece bounds (piece ${this.pieceIndex})`);
    }

    if (!this.received[blockIndex]) {
      data.copy(this.buffer, begin);
      this.received[blockIndex] = true;
      this.receivedCount++;
    }
    // if already received (duplicate block), silently ignore — don't double-count

    return this.isComplete();
  }

  isComplete(): boolean {
    return this.receivedCount === this.received.length;
  }

  getData(): Buffer {
    if (!this.isComplete()) {
      throw new Error(`PieceAssembler: piece ${this.pieceIndex} is not yet complete`);
    }
    return this.buffer;
  }
}