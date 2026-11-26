/** Returns only the part of a packet that has not already been replayed. */
export function remainingPacketBytes(packet: Uint8Array, sequence: number, lastSequence: number): Uint8Array {
  if (!sequence) return packet;
  const packetStart = Math.max(0, sequence - packet.length);
  const overlap = Math.min(packet.length, Math.max(0, lastSequence - packetStart));
  return packet.subarray(overlap);
}
