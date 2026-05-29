import { Platform } from 'react-native';
import { FaceDetection, FrameSample } from '../../types/faceguard';
import { decodeBestBlazeFace } from './blazeFaceDecode';
import {
  averageLuminance,
  cropAndNormalizeMobileFaceNet,
  estimateTextureScore,
  letterboxToBlazeFace,
  loadRgbaFromPhotoPath,
  mapNormalizedBoxToSource
} from './imageTensor';
import { ModelAdapter } from './ModelAdapter';
import { BLAZE_FACE_MODEL, MOBILE_FACENET_MODEL } from './modelAssets';
import { PhotoBasedModelAdapter } from './PhotoBasedModelAdapter';
import { normalizeEmbedding } from './vector';

type PreparedPhoto = {
  rgba: Awaited<ReturnType<typeof loadRgbaFromPhotoPath>>;
  letterbox: ReturnType<typeof letterboxToBlazeFace>;
  detection: ReturnType<typeof decodeBestBlazeFace>;
};

/**
 * On-device BlazeFace + MobileFaceNet inference via react-native-fast-tflite.
 * Falls back to PhotoBasedModelAdapter when native models are unavailable.
 */
export class TfliteModelAdapter implements ModelAdapter {
  private blazeFace?: any;
  private mobileFaceNet?: any;
  private readonly fallback = new PhotoBasedModelAdapter();
  private readonly photoCache = new Map<string, PreparedPhoto>();
  private useNativeModels = false;
  private initialized = false;

  async initialize(): Promise<void> {
    try {
      // Load lazily so Nitro failures fall back cleanly instead of crashing on import.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fastTflite = require('react-native-fast-tflite');
      const { loadTensorflowModel } = fastTflite as {
        loadTensorflowModel: (source: unknown, delegates: unknown) => Promise<any>;
      };
      this.blazeFace = await this.loadBlazeFaceModel(loadTensorflowModel);
      this.mobileFaceNet = await loadTensorflowModel(MOBILE_FACENET_MODEL, 'default');
      this.useNativeModels = true;
    } catch (error) {
      console.warn('TFLite models unavailable, using photo-based fallback.', error);
      await this.fallback.initialize();
      this.useNativeModels = false;
      this.blazeFace = undefined;
      this.mobileFaceNet = undefined;
    }
    this.initialized = true;
  }

  async detectFace(frame: FrameSample): Promise<FaceDetection | undefined> {
    this.ensureReady();
    if (!this.useNativeModels || !frame.photoPath) {
      return this.fallback.detectFace(frame);
    }

    const prepared = await this.preparePhoto(frame.photoPath);
    if (!prepared.detection) {
      return undefined;
    }

    const { detection } = prepared;
    const [leftEye, rightEye, nose, mouth] = detection.keypoints;
    return {
      box: {
        x: detection.xmin,
        y: detection.ymin,
        width: detection.xmax - detection.xmin,
        height: detection.ymax - detection.ymin
      },
      confidence: detection.score,
      landmarks: {
        leftEye: leftEye ?? { x: 0.39, y: 0.38 },
        rightEye: rightEye ?? { x: 0.61, y: 0.38 },
        nose: nose ?? { x: 0.5, y: 0.5 },
        mouthLeft: { x: (mouth?.x ?? 0.5) - 0.04, y: mouth?.y ?? 0.65 },
        mouthRight: { x: (mouth?.x ?? 0.5) + 0.04, y: mouth?.y ?? 0.65 },
        upperLip: { x: mouth?.x ?? 0.5, y: (mouth?.y ?? 0.65) - 0.02 },
        lowerLip: { x: mouth?.x ?? 0.5, y: (mouth?.y ?? 0.65) + 0.02 }
      }
    };
  }

  async estimateTextureLiveness(frame: FrameSample): Promise<number> {
    this.ensureReady();
    if (!this.useNativeModels || !frame.photoPath) {
      return this.fallback.estimateTextureLiveness(frame);
    }

    const prepared = await this.preparePhoto(frame.photoPath);
    const textureScore = estimateTextureScore(prepared.rgba);
    const luminance = averageLuminance(prepared.rgba);
    const lightingPenalty = luminance < 0.28 ? 0.12 : 0;
    return Math.max(0, Math.min(1, textureScore - lightingPenalty));
  }

  async createEmbedding(frame: FrameSample, face: FaceDetection): Promise<number[]> {
    this.ensureReady();
    if (!this.useNativeModels || !frame.photoPath || !this.mobileFaceNet) {
      return this.fallback.createEmbedding(frame, face);
    }

    const prepared = await this.preparePhoto(frame.photoPath);
    if (!prepared.detection) {
      throw new Error('No face available for embedding extraction.');
    }

    const crop = mapNormalizedBoxToSource(prepared.detection, prepared.letterbox);
    const input = cropAndNormalizeMobileFaceNet(prepared.rgba, crop);
    const outputs = await this.mobileFaceNet.run([input as any]);
    const embeddings = outputs[0];

    if (!embeddings || embeddings.byteLength < 192 * 4) {
      throw new Error('MobileFaceNet returned an invalid embedding tensor.');
    }

    const vector = typedArrayToNumbers(embeddings).slice(0, 192);
    return normalizeEmbedding(vector);
  }

  private async preparePhoto(photoPath: string): Promise<PreparedPhoto> {
    const cached = this.photoCache.get(photoPath);
    if (cached) {
      return cached;
    }

    const rgba = await loadRgbaFromPhotoPath(photoPath);
    const letterbox = letterboxToBlazeFace(rgba);
    let detection: ReturnType<typeof decodeBestBlazeFace>;

    if (this.blazeFace) {
      const outputs = await this.blazeFace.run([letterbox.tensor as any]);
      const rawBoxes = outputs[0];
      const rawScores = outputs[1];
      detection =
        rawBoxes && rawScores ? decodeBestBlazeFace(rawBoxes, rawScores) : undefined;
    } else {
      detection = undefined;
    }

    const prepared = { rgba, letterbox, detection };
    this.photoCache.set(photoPath, prepared);
    return prepared;
  }

  private async loadBlazeFaceModel(
    loadTensorflowModel: (source: unknown, delegates: unknown) => Promise<any>
  ): Promise<any> {
    if (Platform.OS === 'ios') {
      try {
        return await loadTensorflowModel(BLAZE_FACE_MODEL, 'core-ml');
      } catch {
        return loadTensorflowModel(BLAZE_FACE_MODEL, 'default');
      }
    }
    return loadTensorflowModel(BLAZE_FACE_MODEL, 'default');
  }

  private ensureReady(): void {
    if (!this.initialized) {
      throw new Error('TfliteModelAdapter was used before initialization.');
    }
  }
}

function typedArrayToNumbers(values: ArrayBuffer | ArrayLike<number>): number[] {
  if (values instanceof ArrayBuffer) {
    const floats = new Float32Array(values);
    return Array.from(floats, value => Number(value));
  }

  return Array.from(values, value => Number(value));
}
