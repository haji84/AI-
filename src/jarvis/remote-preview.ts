import sharp from "sharp";

// Preview only. Recording and callers that do not request preview retain PNG.
export async function remotePreview(imageBase64: string) {
  if (imageBase64.length > 12 * 1024 * 1024) throw new Error("Screenshot exceeds preview limit");
  const png = Buffer.from(imageBase64, "base64");
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid screenshot PNG");
  const jpeg = await sharp(png, { limitInputPixels: 20_000_000 }).jpeg({ quality: 55 }).toBuffer();
  return { mimeType: "image/jpeg", imageBase64: jpeg.toString("base64") };
}
