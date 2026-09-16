import sharp from "sharp";

// Preview only. Recording and callers that do not request preview retain PNG.
export async function remotePreview(imageBase64: string, compact = false) {
  if (imageBase64.length > 12 * 1024 * 1024) throw new Error("Screenshot exceeds preview limit");
  const png = Buffer.from(imageBase64, "base64");
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid screenshot PNG");
  const source = sharp(png, { limitInputPixels: 20_000_000 });
  const metadata = await source.metadata();
  if (compact) source.resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true });
  const jpeg = await source.jpeg({ quality: 55 }).toBuffer();
  return { mimeType: "image/jpeg", imageBase64: jpeg.toString("base64"), nativeWidth: metadata.width, nativeHeight: metadata.height };
}

// AOSP screencap emits packed rows after a 12-byte legacy or 16-byte header.
// Only RGBA_8888 / RGBX_8888 in known colour spaces are accepted here.
export async function rawRemotePreview(raw: Buffer) {
  if (raw.length < 12) throw new Error("Invalid raw screenshot header");
  const width = raw.readUInt32LE(0), height = raw.readUInt32LE(4), format = raw.readUInt32LE(8);
  if (!width || !height || width > 20_000 || height > 20_000 || width * height > 4_000_000 || ![1, 2].includes(format)) throw new Error("Unsupported raw screenshot dimensions/format");
  const offset = raw.length - width * height * 4;
  if (offset !== 12 && offset !== 16) throw new Error("Invalid raw screenshot length");
  if (offset === 16 && ![0, 1].includes(raw.readUInt32LE(12))) throw new Error("Unsupported raw screenshot colour space");
  const jpeg = await sharp(raw.subarray(offset), { raw: { width, height, channels: 4 } })
    .removeAlpha().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 55 }).toBuffer();
  return { mimeType: "image/jpeg", imageBase64: jpeg.toString("base64"), nativeWidth: width, nativeHeight: height };
}

export async function captureRemotePreview(capture: (raw: boolean) => Promise<Buffer>) {
  const started = performance.now();
  try {
    const result = await rawRemotePreview(await capture(true));
    return { ...result, previewSource: "raw", captureAndEncodeMs: Math.round(performance.now() - started) };
  } catch {
    // Preserve supported capture on devices with other pixel formats/headers.
    const result = await remotePreview((await capture(false)).toString("base64"), true);
    return { ...result, previewSource: "png-fallback", captureAndEncodeMs: Math.round(performance.now() - started) };
  }
}
