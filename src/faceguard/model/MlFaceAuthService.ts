import { FACEGUARD_CONFIG } from '../config';
import { FaceAuthFailure, FaceAuthResult } from '../../types/faceguard';
import { buildFrameSampleFromPhoto } from './PhotoTensorBuilder';
import { createPhotoDescriptor } from '../biometrics/PhotoDescriptor';
import { getLocalEnrollment, saveLocalEnrollment } from '../biometrics/LocalEnrollmentStore';
import { TfliteModelAdapter } from './TfliteModelAdapter';

type MlFaceAuthOptions = {
  faceDetector: number;
  faceRecognizer: number;
  antiSpoof?: number;
};

const MATCH_THRESHOLD = 0.72;
const LIVENESS_THRESHOLD = 0.45;

export class MlFaceAuthService {
  private readonly adapter = new TfliteModelAdapter();
  private initialized = false;

  constructor(_options: MlFaceAuthOptions) {}

  async initialize(): Promise<void> {
    await this.adapter.initialize();
    this.initialized = true;
  }

  async enroll(photoPaths: string[] | string): Promise<void> {
    this.ensureReady();
    const [photoPath] = Array.isArray(photoPaths) ? photoPaths : [photoPaths];
    if (!photoPath) {
      throw failure('NO_FACE', 'No enrollment photo was captured.');
    }

    const frame = await buildFrameSampleFromPhoto(photoPath, 112);
    const face = await this.adapter.detectFace(frame);
    if (!face) {
      throw failure('NO_FACE', 'No face detected in the captured image. Try again with better framing.');
    }

    const embedding = await this.adapter.createEmbedding(frame, face);
    const descriptor = await createPhotoDescriptor(photoPath);
    await saveLocalEnrollment({
      userId: 'DL-FIELD-LOCAL',
      name: 'Local Field User',
      embedding,
      descriptor,
      enrolledAt: new Date().toISOString()
    });
  }

  async authenticate(photoPaths: string[], deviceId: string): Promise<FaceAuthResult> {
    this.ensureReady();
    const enrollment = await getLocalEnrollment();
    if (!enrollment) {
      throw failure('MATCH_FAILED', 'No offline enrollment found. Enroll your face first.');
    }

    const enrollmentVector = enrollment.embedding ?? enrollment.descriptor?.vector;
    if (!enrollmentVector) {
      throw failure('MATCH_FAILED', 'Saved offline enrollment is incomplete. Re-enroll your face.');
    }

    const frames = await Promise.all(photoPaths.map(path => buildFrameSampleFromPhoto(path, 112)));
    const scored = [];

    for (const frame of frames) {
      const face = await this.adapter.detectFace(frame);
      if (!face) {
        continue;
      }

      const embedding = await this.adapter.createEmbedding(frame, face);
      const score = this.compareEmbeddings(embedding, enrollmentVector);
      const liveness = await this.adapter.estimateTextureLiveness(frame);
      scored.push({ score, liveness });
    }

    if (scored.length === 0) {
      throw failure('NO_FACE', 'No usable face was detected in the camera captures.');
    }

    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (best.liveness < LIVENESS_THRESHOLD) {
      throw failure('LIVENESS_FAILED', 'The captured face did not look live enough. Try blinking or turning your head.');
    }

    if (best.score < MATCH_THRESHOLD) {
      throw failure('MATCH_FAILED', `Face did not match the offline enrollment. Score ${best.score.toFixed(4)}.`);
    }

    return {
      id: `${Date.now()}`,
      userId: enrollment.userId,
      matched: true,
      score: Number(best.score.toFixed(4)),
      livenessScore: Number(best.liveness.toFixed(4)),
      modelVersion: FACEGUARD_CONFIG.modelVersion,
      createdAt: new Date().toISOString(),
      deviceId,
      durationMs: 0
    };
  }

  private ensureReady() {
    if (!this.initialized) {
      throw failure('MODEL_UNAVAILABLE', 'ML models are not initialized yet.');
    }
  }

  private compareEmbeddings(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let index = 0; index < length; index += 1) {
      dot += a[index] * b[index];
      magA += a[index] * a[index];
      magB += b[index] * b[index];
    }

    if (magA === 0 || magB === 0) {
      return 0;
    }

    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}

function failure(code: FaceAuthFailure['code'], reason: string): FaceAuthFailure {
  return { code, reason };
}
