import { randomBytes } from "node:crypto";

// BEP 20 convention: -<2 letter client id><4 digit version>-<12 random bytes>
const CLIENT_PREFIX = "-TF0001-";

let cachedPeerId: Buffer | null = null;

export function getPeerId(): Buffer {
  if (cachedPeerId) return cachedPeerId;
  const prefix = Buffer.from(CLIENT_PREFIX, "ascii");
  const random = randomBytes(20 - prefix.length);
  cachedPeerId = Buffer.concat([prefix, random]);
  return cachedPeerId;
}