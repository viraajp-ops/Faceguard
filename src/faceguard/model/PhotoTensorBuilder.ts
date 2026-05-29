import * as FileSystem from 'expo-file-system';
import jpeg from 'jpeg-js';
import { FrameSample } from '../../types/faceguard';

export async function buildFrameSampleFromPhoto(
  photoPath: string,
  targetSize = 128
): Promise<FrameSample> {
  const uri = photoPath.startsWith('file://') ? photoPath : `file://${photoPath}`;
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const decoded = jpeg.decode(base64ToUint8Array(base64), { useTArray: true });
  const resized = resizeRgb(decoded.data, decoded.width, decoded.height, targetSize, targetSize);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    luminance: computeLuminance(resized),
    textureScore: computeTextureScore(resized),
    rgbData: resized
  };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(base64) : base64;
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function resizeRgb(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth));
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const targetIndex = (y * targetWidth + x) * 3;
      output[targetIndex] = source[sourceIndex];
      output[targetIndex + 1] = source[sourceIndex + 1];
      output[targetIndex + 2] = source[sourceIndex + 2];
    }
  }

  return output;
}

function computeLuminance(rgb: Uint8Array): number {
  if (rgb.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < rgb.length; index += 3) {
    sum += (rgb[index] * 0.2126 + rgb[index + 1] * 0.7152 + rgb[index + 2] * 0.0722) / 255;
  }
  return Number(Math.max(0, Math.min(1, sum / (rgb.length / 3))).toFixed(4));
}

function computeTextureScore(rgb: Uint8Array): number {
  if (rgb.length < 9) {
    return 0;
  }
  let gradient = 0;
  for (let index = 3; index < rgb.length; index += 3) {
    gradient += Math.abs(rgb[index] - rgb[index - 3]);
    gradient += Math.abs(rgb[index + 1] - rgb[index - 2]);
    gradient += Math.abs(rgb[index + 2] - rgb[index - 1]);
  }
  return Number(Math.max(0, Math.min(1, gradient / rgb.length)).toFixed(4));
}
