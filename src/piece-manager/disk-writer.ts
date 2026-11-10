import { open, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TorrentFileInfo } from "../torrent-file/types.js";

interface FileRange {
  path: string[];
  startOffset: number; // inclusive, offset within the whole torrent's concatenated data
  endOffset: number;   // exclusive
  length: number;
}

/**
 * Writes downloaded, verified pieces to disk at the correct file(s) and
 * byte offsets — handling the case where a single piece spans multiple
 * files in a multi-file torrent.
 */
export class DiskWriter {
  private ranges: FileRange[];
  private handles: Map<string, FileHandle> = new Map();
  private readonly outputDir: string;
  private readonly pieceLength: number;

  constructor(outputDir: string, files: TorrentFileInfo[], pieceLength: number) {
    this.outputDir = outputDir;
    this.pieceLength = pieceLength;

    let cursor = 0;
    this.ranges = files.map((f) => {
      const range: FileRange = {
        path: f.path,
        startOffset: cursor,
        endOffset: cursor + f.length,
        length: f.length,
      };
      cursor += f.length;
      return range;
    });
  }

  /** Must be called once before writePiece — creates directories and opens file handles. */
  async init(): Promise<void> {
    for (const range of this.ranges) {
      const fullPath = join(this.outputDir, ...range.path);
      await mkdir(dirname(fullPath), { recursive: true });
      const handle = await open(fullPath, "w+");
      this.handles.set(this.rangeKey(range), handle);
    }
  }

  /** Writes one downloaded piece's data, splitting across files as needed. */
  async writePiece(pieceIndex: number, data: Buffer): Promise<void> {
    const pieceStart = pieceIndex * this.pieceLength;
    const pieceEnd = pieceStart + data.length;

    for (const range of this.ranges) {
      // Does this piece overlap this file's byte range at all?
      const overlapStart = Math.max(pieceStart, range.startOffset);
      const overlapEnd = Math.min(pieceEnd, range.endOffset);

      if (overlapStart >= overlapEnd) continue; // no overlap with this file

      const handle = this.handles.get(this.rangeKey(range));
      if (!handle) throw new Error(`DiskWriter: no open handle for ${range.path.join("/")}`);

      const dataSliceStart = overlapStart - pieceStart;
      const dataSliceEnd = overlapEnd - pieceStart;
      const chunk = data.subarray(dataSliceStart, dataSliceEnd);

      const writeOffsetInFile = overlapStart - range.startOffset;
      await handle.write(chunk, 0, chunk.length, writeOffsetInFile);
    }
  }

  async close(): Promise<void> {
    for (const handle of this.handles.values()) {
      await handle.close();
    }
    this.handles.clear();
  }

  private rangeKey(range: FileRange): string {
    return range.path.join("/");
  }
}