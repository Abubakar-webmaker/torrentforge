const PROTOCOL_STRING = "BitTorrent protocol";
const PSTRLEN = PROTOCOL_STRING.length; // 19
const HANDSHAKE_LENGTH = 49 + PSTRLEN; // 68 bytes total

export interface Handshake {
  infoHash: Buffer;
  peerId: Buffer;
  reservedBytes: Buffer; // 8 bytes — extension flags (we don't use any yet)
}

export function buildHandshake(infoHash: Buffer, peerId: Buffer): Buffer {
  if (infoHash.length !== 20) throw new Error("Handshake: infoHash must be 20 bytes");
  if (peerId.length !== 20) throw new Error("Handshake: peerId must be 20 bytes");

  const buf = Buffer.alloc(HANDSHAKE_LENGTH);
  let offset = 0;

  buf.writeUInt8(PSTRLEN, offset); offset += 1;
  buf.write(PROTOCOL_STRING, offset, "ascii"); offset += PSTRLEN;
  offset += 8; // reserved bytes — leave as zero (no extensions)
  infoHash.copy(buf, offset); offset += 20;
  peerId.copy(buf, offset); offset += 20;

  return buf;
}

/** Parses a received handshake buffer. Throws if malformed or protocol mismatch. */
export function parseHandshake(buf: Buffer): Handshake {
  if (buf.length !== HANDSHAKE_LENGTH) {
    throw new Error(`Handshake: expected ${HANDSHAKE_LENGTH} bytes, got ${buf.length}`);
  }

  const pstrlen = buf.readUInt8(0);
  if (pstrlen !== PSTRLEN) {
    throw new Error(`Handshake: unexpected pstrlen ${pstrlen}`);
  }

  const protocolStr = buf.subarray(1, 1 + PSTRLEN).toString("ascii");
  if (protocolStr !== PROTOCOL_STRING) {
    throw new Error(`Handshake: unexpected protocol string '${protocolStr}'`);
  }

  const reservedBytes = buf.subarray(20, 28);
  const infoHash = buf.subarray(28, 48);
  const peerId = buf.subarray(48, 68);

  return { infoHash, peerId, reservedBytes };
}

export { HANDSHAKE_LENGTH };