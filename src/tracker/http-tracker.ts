import { BencodeDecoder, type BencodeValue } from "../bencode/decoder.js";
import type { TrackerAnnounceParams, TrackerResponse, TrackerPeer } from "./types.js";

/**
 * Builds the query string manually because info_hash and peer_id are
 * raw bytes that must be percent-encoded byte-by-byte — the standard
 * URLSearchParams class mangles binary data, so we can't use it here.
 */
function buildAnnounceUrl(baseUrl: string, params: TrackerAnnounceParams): string {
  const parts: string[] = [
    `info_hash=${percentEncodeBytes(params.infoHash)}`,
    `peer_id=${percentEncodeBytes(params.peerId)}`,
    `port=${params.port}`,
    `uploaded=${params.uploaded}`,
    `downloaded=${params.downloaded}`,
    `left=${params.left}`,
    `compact=1`,
  ];
  if (params.event) {
    parts.push(`event=${params.event}`);
  }
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${parts.join("&")}`;
}

function percentEncodeBytes(buf: Buffer): string {
  let result = "";
  for (const byte of buf) {
    // Unreserved characters can stay literal; everything else is %XX
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e; // - . _ ~

    result += isUnreserved
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return result;
}

/** Parses BEP 23 "compact" peer format: 6 bytes per peer (4 IP + 2 port) */
function parseCompactPeers(buf: Buffer): TrackerPeer[] {
  if (buf.length % 6 !== 0) {
    throw new Error("Tracker: compact peers buffer length is not a multiple of 6");
  }
  const peers: TrackerPeer[] = [];
  for (let i = 0; i < buf.length; i += 6) {
    const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
    const port = buf.readUInt16BE(i + 4);
    peers.push({ ip, port });
  }
  return peers;
}

export async function announceHttp(
  trackerUrl: string,
  params: TrackerAnnounceParams,
  signal?: AbortSignal
): Promise<TrackerResponse> {
  const url = buildAnnounceUrl(trackerUrl, params);

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Tracker: HTTP ${res.status} from ${trackerUrl}`);
  }

  const bodyBuf = Buffer.from(await res.arrayBuffer());
  const decoded = BencodeDecoder.decode(bodyBuf) as { [key: string]: BencodeValue };

  if (decoded["failure reason"] !== undefined) {
    const reason = (decoded["failure reason"] as Buffer).toString("utf8");
    throw new Error(`Tracker returned failure: ${reason}`);
  }

  const interval = decoded.interval as number;
  const peersField = decoded.peers;

  let peers: TrackerPeer[];
  if (Buffer.isBuffer(peersField)) {
    // compact format
    peers = parseCompactPeers(peersField);
  } else if (Array.isArray(peersField)) {
    // non-compact (dictionary) format — some trackers still use this
    peers = peersField.map((p) => {
      const d = p as { [key: string]: BencodeValue };
      return {
        ip: (d.ip as Buffer).toString("utf8"),
        port: d.port as number,
      };
    });
  } else {
    throw new Error("Tracker: response missing valid 'peers' field");
  }

  return {
    interval,
    peers,
    seeders: typeof decoded.complete === "number" ? decoded.complete : undefined,
    leechers: typeof decoded.incomplete === "number" ? decoded.incomplete : undefined,
  };
}