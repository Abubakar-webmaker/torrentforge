/**
 * Wraps the bitfield byte buffer used in the BitTorrent wire protocol.
 * Bit 0 of byte 0 = piece index 0 (most significant bit first).
 */
export class Bitfield {
  private buf: Buffer;
  public readonly numPieces: number;

  constructor(numPieces: number, existing?: Buffer) {
    this.numPieces = numPieces;
    const requiredBytes = Math.ceil(numPieces / 8);

    if (existing) {
      if (existing.length !== requiredBytes) {
        throw new Error(
          `Bitfield: expected ${requiredBytes} bytes for ${numPieces} pieces, got ${existing.length}`
        );
      }
      this.buf = existing;
    } else {
      this.buf = Buffer.alloc(requiredBytes);
    }
  }

  has(pieceIndex: number): boolean {
    this.assertValidIndex(pieceIndex);
    const byteIndex = Math.floor(pieceIndex / 8);
    const bitOffset = pieceIndex % 8;
    return (this.buf[byteIndex]! & (0x80 >> bitOffset)) !== 0;
  }

  set(pieceIndex: number): void {
    this.assertValidIndex(pieceIndex);
    const byteIndex = Math.floor(pieceIndex / 8);
    const bitOffset = pieceIndex % 8;
    this.buf[byteIndex]! |= 0x80 >> bitOffset;
  }

  toBuffer(): Buffer {
    return this.buf;
  }

  countSet(): number {
    let count = 0;
    for (let i = 0; i < this.numPieces; i++) {
      if (this.has(i)) count++;
    }
    return count;
  }

  isComplete(): boolean {
    return this.countSet() === this.numPieces;
  }

  private assertValidIndex(pieceIndex: number): void {
    if (pieceIndex < 0 || pieceIndex >= this.numPieces) {
      throw new Error(`Bitfield: piece index ${pieceIndex} out of range (0-${this.numPieces - 1})`);
    }
  }
}