import * as FileSystem from 'expo-file-system';
import { cosineSimilarity, normalizeEmbedding } from '../model/vector';

export type PhotoDescriptor = {
  vector: number[];
  qualityScore: number;
  byteLength: number;
};

const HISTOGRAM_BINS = 48;
const SEGMENT_BINS = 32;

export async function createPhotoDescriptor(photoPath: string): Promise<PhotoDescriptor> {
  const uri = photoPath.startsWith('file://') ? photoPath : `file://${photoPath}`;
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });

  const histogram = Array.from({ length: HISTOGRAM_BINS }, () => 0);
  const segmentMeans = Array.from({ length: SEGMENT_BINS }, () => 0);
  const segmentCounts = Array.from({ length: SEGMENT_BINS }, () => 0);
  let transitions = 0;
  let previousCode = 0;

  for (let index = 0; index < base64.length; index += 1) {
    const code = base64.charCodeAt(index);
    histogram[code % HISTOGRAM_BINS] += 1;
    const segmentIndex = Math.min(
      SEGMENT_BINS - 1,
      Math.floor((index / Math.max(base64.length, 1)) * SEGMENT_BINS)
    );
    segmentMeans[segmentIndex] += code;
    segmentCounts[segmentIndex] += 1;
    transitions += Math.abs(code - previousCode);
    previousCode = code;
  }

  const orderedProfile = segmentMeans.map((sum, index) => {
    const count = Math.max(segmentCounts[index], 1);
    return (sum / count) / 255;
  });

  const normalized = normalizeEmbedding([
    ...histogram,
    ...orderedProfile,
    ...buildDeltaProfile(base64)
  ]);
  const entropyProxy = transitions / Math.max(base64.length, 1) / 64;
  const qualityScore = Math.max(0, Math.min(1, entropyProxy));

  return {
    vector: normalized,
    qualityScore,
    byteLength: base64.length
  };
}

export function comparePhotoDescriptors(a: PhotoDescriptor, b: PhotoDescriptor): number {
  const vectorScore = cosineSimilarity(a.vector, b.vector);
  const sizeScore = 1 - Math.abs(a.byteLength - b.byteLength) / Math.max(a.byteLength, b.byteLength, 1);
  const qualityScore = 1 - Math.abs(a.qualityScore - b.qualityScore);
  return Number(
    Math.max(
      0,
      Math.min(1, vectorScore * 0.72 + sizeScore * 0.18 + qualityScore * 0.1)
    ).toFixed(4)
  );
}

export function estimateSequenceLiveness(descriptors: PhotoDescriptor[]): number {
  if (descriptors.length < 2) {
    return 0;
  }

  const deltas: number[] = [];
  for (let index = 1; index < descriptors.length; index += 1) {
    deltas.push(1 - comparePhotoDescriptors(descriptors[index - 1], descriptors[index]));
  }

  const averageMotion = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const averageQuality =
    descriptors.reduce((sum, descriptor) => sum + descriptor.qualityScore, 0) / descriptors.length;

  return Number(Math.max(0, Math.min(1, averageMotion * 7 + averageQuality * 0.25)).toFixed(4));
}

function buildDeltaProfile(base64: string): number[] {
  const buckets = Array.from({ length: 16 }, () => 0);
  if (base64.length === 0) {
    return buckets;
  }

  let rolling = 0;
  for (let index = 0; index < base64.length; index += 1) {
    const code = base64.charCodeAt(index);
    rolling = (rolling + code * (index + 1)) % 1024;
    const bucketIndex = index % buckets.length;
    buckets[bucketIndex] += (rolling + code) / 2048;
  }

  return buckets.map(value => value / Math.max(base64.length / buckets.length, 1));
}
