import { describe, expect, it } from 'vitest';
import { remainingPacketBytes } from './terminalReplay';

const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe('terminal replay boundaries', () => {
  it('keeps a packet that starts after the snapshot', () => {
    expect(text(remainingPacketBytes(bytes('prompt'), 12, 5))).toBe('prompt');
  });

  it('drops a packet already covered by the snapshot', () => {
    expect(remainingPacketBytes(bytes('prompt'), 12, 12)).toHaveLength(0);
  });

  it('keeps only the suffix when a packet straddles the snapshot boundary', () => {
    const packet = bytes('[renew@beifen ~]$ ');
    const sequence = 100;
    const packetStart = sequence - packet.length;
    const snapshotSequence = packetStart + 8;
    expect(text(remainingPacketBytes(packet, sequence, snapshotSequence))).toBe(text(packet.subarray(8)));
  });

  it('preserves legacy packets that have no sequence', () => {
    const packet = bytes('legacy');
    expect(remainingPacketBytes(packet, 0, 999)).toEqual(packet);
  });
});
