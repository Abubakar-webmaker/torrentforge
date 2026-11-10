export enum MessageType {
  Choke = 0,
  Unchoke = 1,
  Interested = 2,
  NotInterested = 3,
  Have = 4,
  Bitfield = 5,
  Request = 6,
  Piece = 7,
  Cancel = 8,
}

export type PeerMessage =
  | { type: "keepalive" }
  | { type: MessageType.Choke }
  | { type: MessageType.Unchoke }
  | { type: MessageType.Interested }
  | { type: MessageType.NotInterested }
  | { type: MessageType.Have; pieceIndex: number }
  | { type: MessageType.Bitfield; bitfield: Buffer }
  | { type: MessageType.Request; pieceIndex: number; begin: number; length: number }
  | { type: MessageType.Piece; pieceIndex: number; begin: number; block: Buffer }
  | { type: MessageType.Cancel; pieceIndex: number; begin: number; length: number };

export function encodeMessage(msg: PeerMessage): Buffer {
  if (msg.type === "keepalive") {
    return Buffer.alloc(4); // length-prefix 0, no id, no payload
  }

  let payload: Buffer;

  switch (msg.type) {
    case MessageType.Choke:
    case MessageType.Unchoke:
    case MessageType.Interested:
    case MessageType.NotInterested:
      payload = Buffer.alloc(0);
      break;

    case MessageType.Have: {
      payload = Buffer.alloc(4);
      payload.writeUInt32BE(msg.pieceIndex, 0);
      break;
    }

    case MessageType.Bitfield:
      payload = msg.bitfield;
      break;

    case MessageType.Request:
    case MessageType.Cancel: {
      payload = Buffer.alloc(12);
      payload.writeUInt32BE(msg.pieceIndex, 0);
      payload.writeUInt32BE(msg.begin, 4);
      payload.writeUInt32BE(msg.length, 8);
      break;
    }

    case MessageType.Piece: {
      payload = Buffer.alloc(8 + msg.block.length);
      payload.writeUInt32BE(msg.pieceIndex, 0);
      payload.writeUInt32BE(msg.begin, 4);
      msg.block.copy(payload, 8);
      break;
    }

    default: {
      const exhaustiveCheck: never = msg;
      throw new Error(`Unknown message type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }

  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(1 + payload.length, 0); // 1 byte for message id

  const idByte = Buffer.from([msg.type]);
  return Buffer.concat([lengthPrefix, idByte, payload]);
}

/**
 * Attempts to decode ONE message from the start of buf.
 * Returns null if buf doesn't yet contain a full message (need more data from socket).
 * This is designed to be called repeatedly against a growing receive buffer.
 */
export function decodeMessage(buf: Buffer): { message: PeerMessage; bytesConsumed: number } | null {
  if (buf.length < 4) return null; // not even the length prefix yet

  const length = buf.readUInt32BE(0);
  if (length === 0) {
    return { message: { type: "keepalive" }, bytesConsumed: 4 };
  }

  const totalNeeded = 4 + length;
  if (buf.length < totalNeeded) return null; // full message not received yet

  const id = buf.readUInt8(4);
  const payload = buf.subarray(5, totalNeeded);

  let message: PeerMessage;

  switch (id) {
    case MessageType.Choke: message = { type: MessageType.Choke }; break;
    case MessageType.Unchoke: message = { type: MessageType.Unchoke }; break;
    case MessageType.Interested: message = { type: MessageType.Interested }; break;
    case MessageType.NotInterested: message = { type: MessageType.NotInterested }; break;

    case MessageType.Have:
      if (payload.length !== 4) throw new Error("Wire: malformed 'have' message");
      message = { type: MessageType.Have, pieceIndex: payload.readUInt32BE(0) };
      break;

    case MessageType.Bitfield:
      message = { type: MessageType.Bitfield, bitfield: Buffer.from(payload) };
      break;

    case MessageType.Request:
      if (payload.length !== 12) throw new Error("Wire: malformed 'request' message");
      message = {
        type: MessageType.Request,
        pieceIndex: payload.readUInt32BE(0),
        begin: payload.readUInt32BE(4),
        length: payload.readUInt32BE(8),
      };
      break;

    case MessageType.Piece:
      if (payload.length < 8) throw new Error("Wire: malformed 'piece' message");
      message = {
        type: MessageType.Piece,
        pieceIndex: payload.readUInt32BE(0),
        begin: payload.readUInt32BE(4),
        block: Buffer.from(payload.subarray(8)),
      };
      break;

    case MessageType.Cancel:
      if (payload.length !== 12) throw new Error("Wire: malformed 'cancel' message");
      message = {
        type: MessageType.Cancel,
        pieceIndex: payload.readUInt32BE(0),
        begin: payload.readUInt32BE(4),
        length: payload.readUInt32BE(8),
      };
      break;

    default:
      throw new Error(`Wire: unknown message id ${id}`);
  }

  return { message, bytesConsumed: totalNeeded };
}