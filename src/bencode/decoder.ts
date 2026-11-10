export type BencodeValue =
  | Buffer
  | number
  | BencodeValue[]
  | { [key: string]: BencodeValue };

export class BencodeDecoder {
  private buf: Buffer;
  private pos: number;

  constructor(data: Buffer) {
    this.buf = data;
    this.pos = 0;
  }

  static decode(data: Buffer): BencodeValue {
    const decoder = new BencodeDecoder(data);
    const result = decoder.decodeValue();
    if (decoder.pos !== data.length) {
      throw new Error("Bencode: trailing data after valid value");
    }
    return result;
  }

  private decodeValue(): BencodeValue {
    const byte = this.buf[this.pos];
    if (byte === undefined) {
      throw new Error("Bencode: unexpected end of input");
    }
    const char = String.fromCharCode(byte);

    if (char === "i") return this.decodeInteger();
    if (char === "l") return this.decodeList();
    if (char === "d") return this.decodeDictionary();
    if (char >= "0" && char <= "9") return this.decodeString();

    throw new Error(`Bencode: unexpected character '${char}' at position ${this.pos}`);
  }

  private decodeInteger(): number {
    this.expect("i");
    const end = this.buf.indexOf("e", this.pos);
    if (end === -1) throw new Error("Bencode: unterminated integer");

    const numStr = this.buf.subarray(this.pos, end).toString("ascii");
    if (!/^-?\d+$/.test(numStr)) {
      throw new Error(`Bencode: invalid integer '${numStr}'`);
    }
    if (numStr !== "0" && (numStr.startsWith("0") || numStr.startsWith("-0"))) {
      throw new Error(`Bencode: leading zero not allowed in integer '${numStr}'`);
    }

    this.pos = end + 1;
    return Number(numStr);
  }

  private decodeString(): Buffer {
    const colon = this.buf.indexOf(":", this.pos);
    if (colon === -1) throw new Error("Bencode: unterminated string length");

    const lenStr = this.buf.subarray(this.pos, colon).toString("ascii");
    if (!/^\d+$/.test(lenStr)) {
      throw new Error(`Bencode: invalid string length '${lenStr}'`);
    }

    const len = Number(lenStr);
    const start = colon + 1;
    const end = start + len;

    if (end > this.buf.length) {
      throw new Error("Bencode: string length exceeds buffer");
    }

    this.pos = end;
    return this.buf.subarray(start, end);
  }

  private decodeList(): BencodeValue[] {
    this.expect("l");
    const result: BencodeValue[] = [];
    while (this.buf[this.pos] !== "e".charCodeAt(0)) {
      if (this.pos >= this.buf.length) {
        throw new Error("Bencode: unterminated list");
      }
      result.push(this.decodeValue());
    }
    this.pos++; // consume 'e'
    return result;
  }

  private decodeDictionary(): { [key: string]: BencodeValue } {
    this.expect("d");
    const result: { [key: string]: BencodeValue } = {};
    let lastKey: string | null = null;

    while (this.buf[this.pos] !== "e".charCodeAt(0)) {
      if (this.pos >= this.buf.length) {
        throw new Error("Bencode: unterminated dictionary");
      }
      const keyBuf = this.decodeString();
      const key = keyBuf.toString("utf8");

      if (lastKey !== null && key <= lastKey) {
        throw new Error(`Bencode: dictionary keys not in sorted order ('${key}' after '${lastKey}')`);
      }
      lastKey = key;

      result[key] = this.decodeValue();
    }
    this.pos++; // consume 'e'
    return result;
  }

  private expect(char: string): void {
    const byte = this.buf[this.pos];
    if (byte !== char.charCodeAt(0)) {
      throw new Error(`Bencode: expected '${char}' at position ${this.pos}`);
    }
    this.pos++;
  }
}