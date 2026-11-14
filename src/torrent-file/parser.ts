import { createHash } from "node:crypto";
import { BencodeDecoder, type BencodeValue } from "../bencode/decoder.js";
import { BencodeEncoder } from "../bencode/encoder.js";
import type { ParsedTorrent, TorrentFileInfo } from "./types.js";

function asBuffer(value: BencodeValue, fieldName: string): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error(`Torrent file: expected '${fieldName}' to be a string/buffer`);
  }
  return value;
}

function asNumber(value: BencodeValue, fieldName: string): number {
  if (typeof value !== "number") {
    throw new Error(`Torrent file: expected '${fieldName}' to be an integer`);
  }
  return value;
}

function asDict(value: BencodeValue, fieldName: string): { [key: string]: BencodeValue } {
  if (typeof value !== "object" || Buffer.isBuffer(value) || Array.isArray(value)) {
    throw new Error(`Torrent file: expected '${fieldName}' to be a dictionary`);
  }
  return value;
}

function asList(value: BencodeValue, fieldName: string): BencodeValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`Torrent file: expected '${fieldName}' to be a list`);
  }
  return value;
}

export function parseTorrentFile(raw: Buffer): ParsedTorrent {
  const decoded = BencodeDecoder.decode(raw);
  const root = asDict(decoded, "root");

  // --- announce / announce-list (BEP 12) ---
  const announce = asBuffer(root.announce, "announce").toString("utf8");

  let announceList: string[][] = [[announce]];
  if (root["announce-list"] !== undefined) {
    const tiers = asList(root["announce-list"], "announce-list");
    announceList = tiers.map((tier, i) =>
      asList(tier, `announce-list[${i}]`).map((url, j) =>
        asBuffer(url, `announce-list[${i}][${j}]`).toString("utf8")
      )
    );
  }

  // --- info dict ---
  const info = asDict(root.info, "info");

  // Info-hash = SHA1 of the EXACT bencoded 'info' dictionary bytes
  const infoBencoded = BencodeEncoder.encode(info);
  const infoHash = createHash("sha1").update(infoBencoded).digest();

  const pieceLength = asNumber(info["piece length"], "info.piece length");
  const piecesBuf = asBuffer(info.pieces, "info.pieces");

  if (piecesBuf.length % 20 !== 0) {
    throw new Error("Torrent file: 'pieces' length is not a multiple of 20");
  }
  const pieceHashes: Buffer[] = [];
  for (let i = 0; i < piecesBuf.length; i += 20) {
    pieceHashes.push(piecesBuf.subarray(i, i + 20));
  }

  const name = asBuffer(info.name, "info.name").toString("utf8");

  // --- single-file vs multi-file ---
  let files: TorrentFileInfo[] = [];
  let totalLength: number;
  let isMultiFile: boolean;

  if (info.files !== undefined) {
    isMultiFile = true;
    const fileList = asList(info.files, "info.files");
    files = fileList.map((f, i) => {
      const fDict = asDict(f, `info.files[${i}]`);
      const length = asNumber(fDict.length, `info.files[${i}].length`);
      const pathList = asList(fDict.path, `info.files[${i}].path`);
      const path = pathList.map((p, j) =>
        asBuffer(p, `info.files[${i}].path[${j}]`).toString("utf8")
      );
      return { path, length };
    });
    totalLength = files.reduce((sum, f) => sum + f.length, 0);
  } else {
    isMultiFile = false;
    totalLength = asNumber(info.length, "info.length");
    files = [{ path: [name], length: totalLength }];
  }

  return {
    announce,
    announceList,
    infoHash,
    pieceLength,
    pieceHashes,
    name,
    totalLength,
    files,
    isMultiFile,
  };
}