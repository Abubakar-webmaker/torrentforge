import { describe, it, expect } from "vitest";
import { Bitfield } from "./bitfield.js";

describe("Bitfield", () => {
  it("starts with all bits unset", () => {
    const bf = new Bitfield(10);
    for (let i = 0; i < 10; i++) {
      expect(bf.has(i)).toBe(false);
    }
  });

  it("sets and reads individual bits correctly", () => {
    const bf = new Bitfield(10);
    bf.set(0);
    bf.set(7);
    bf.set(9);

    expect(bf.has(0)).toBe(true);
    expect(bf.has(7)).toBe(true);
    expect(bf.has(9)).toBe(true);
    expect(bf.has(1)).toBe(false);
    expect(bf.has(8)).toBe(false);
  });

  it("allocates correct byte length (ceil(numPieces / 8))", () => {
    expect(new Bitfield(8).toBuffer().length).toBe(1);
    expect(new Bitfield(9).toBuffer().length).toBe(2);
    expect(new Bitfield(16).toBuffer().length).toBe(2);
    expect(new Bitfield(17).toBuffer().length).toBe(3);
  });

  it("countSet and isComplete work correctly", () => {
    const bf = new Bitfield(4);
    expect(bf.countSet()).toBe(0);
    expect(bf.isComplete()).toBe(false);

    bf.set(0); bf.set(1); bf.set(2);
    expect(bf.countSet()).toBe(3);
    expect(bf.isComplete()).toBe(false);

    bf.set(3);
    expect(bf.isComplete()).toBe(true);
  });

  it("constructs from an existing buffer (e.g. received from a peer)", () => {
    // byte = 10000001 = bits 0 and 7 set, for 8 pieces
    const existing = Buffer.from([0b10000001]);
    const bf = new Bitfield(8, existing);
    expect(bf.has(0)).toBe(true);
    expect(bf.has(7)).toBe(true);
    expect(bf.has(3)).toBe(false);
  });

  it("rejects a buffer of the wrong length", () => {
    expect(() => new Bitfield(10, Buffer.alloc(1))).toThrow(/expected 2 bytes/);
  });

  it("throws on out-of-range indices", () => {
    const bf = new Bitfield(5);
    expect(() => bf.has(5)).toThrow(/out of range/);
    expect(() => bf.set(-1)).toThrow(/out of range/);
  });
});