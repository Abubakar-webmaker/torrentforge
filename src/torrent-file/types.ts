export interface TorrentFileInfo {
  path: string[];   // e.g. ["folder", "subfolder", "file.txt"]
  length: number;
}

export interface ParsedTorrent {
  announce: string;              // primary tracker URL
  announceList: string[][];      // BEP 12 — multiple trackers, grouped by tier
  infoHash: Buffer;              // SHA1 hash — 20 bytes, torrent's unique ID
  pieceLength: number;            // bytes per piece
  pieceHashes: Buffer[];          // SHA1 hash for each piece (20 bytes each)
  name: string;                   // suggested file/folder name
  totalLength: number;            // sum of all file lengths
  files: TorrentFileInfo[];       // empty path = single-file torrent
  isMultiFile: boolean;
}