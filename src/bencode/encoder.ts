import type { BencodeValue } from "./decoder.js";

export class BencodeEncoder {
  static encode(value: BencodeValue): Buffer {
    return Buffer.concat(BencodeEncoder.encodeValue(value));
  }

  private static encodeValue(value: BencodeValue): Buffer[] {
    if (Buffer.isBuffer(value)) {
      return BencodeEncoder.encodeString(value);
    }
    if (typeof value === "number") {
      return BencodeEncoder.encodeInteger(value);
    }
    if (Array.isArray(value)) {
      return BencodeEncoder.encodeList(value);
    }
    if (typeof value === "object" && value !== null) {
      return BencodeEncoder.encodeDictionary(value);
    }
    throw new Error(`Bencode: cannot encode value of type ${typeof value}`);
  }

  private static encodeInteger(num: number): Buffer[] {
    if (!Number.isInteger(num)) {
      throw new Error(`Bencode: ${num} is not an integer`);
    }
    return [Buffer.from(`i${num}e`, "ascii")];
  }

  private static encodeString(buf: Buffer): Buffer[] {
    const prefix = Buffer.from(`${buf.length}:`, "ascii");
    return [prefix, buf];
  }

  private static encodeList(list: BencodeValue[]): Buffer[] {
    const parts: Buffer[] = [Buffer.from("l", "ascii")];
    for (const item of list) {
      parts.push(...BencodeEncoder.encodeValue(item));
    }
    parts.push(Buffer.from("e", "ascii"));
    return parts;
  }

  private static encodeDictionary(dict: { [key: string]: BencodeValue }): Buffer[] {
    const parts: Buffer[] = [Buffer.from("d", "ascii")];
    // Bencode spec requires dictionary keys sorted by raw byte order
    const sortedKeys = Object.keys(dict).sort();

    for (const key of sortedKeys) {
      parts.push(...BencodeEncoder.encodeString(Buffer.from(key, "utf8")));
      parts.push(...BencodeEncoder.encodeValue(dict[key]));
    }
    parts.push(Buffer.from("e", "ascii"));
    return parts;
  }
}