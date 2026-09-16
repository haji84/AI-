export type VideoPacket = { config: boolean; key: boolean; timestamp: number; data: Uint8Array };
export class VideoPacketParser {
  private bytes = new Uint8Array(0);
  push(chunk: Uint8Array): VideoPacket[] {
    if (chunk.length + this.bytes.length > 4 * 1024 * 1024 + 12) throw new Error("Video buffer limit");
    const joined = new Uint8Array(this.bytes.length + chunk.length); joined.set(this.bytes); joined.set(chunk, this.bytes.length); this.bytes = joined;
    const packets: VideoPacket[] = [];
    while (this.bytes.length >= 12) {
      const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
      const flags = view.getBigUint64(0), length = view.getUint32(8);
      if (!length || length > 4 * 1024 * 1024) throw new Error("Invalid video packet size");
      if (this.bytes.length < 12 + length) break;
      packets.push({ config: Boolean(flags & (BigInt(1) << BigInt(63))), key: Boolean(flags & (BigInt(1) << BigInt(62))), timestamp: Number(flags & ((BigInt(1) << BigInt(62)) - BigInt(1))), data: this.bytes.slice(12, 12 + length) });
      this.bytes = this.bytes.slice(12 + length);
    }
    return packets;
  }
}
export function avcCodec(config: Uint8Array): string {
  for (let i = 0; i + 7 < config.length; i++) {
    if (config[i] === 0 && config[i+1] === 0 && config[i+2] === 1 && (config[i+3] & 31) === 7) {
      return "avc1." + [...config.slice(i+4,i+7)].map(n=>n.toString(16).padStart(2,"0")).join("");
    }
  }
  throw new Error("Video SPS unavailable");
}

