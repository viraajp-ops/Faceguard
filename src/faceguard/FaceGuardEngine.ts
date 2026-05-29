import { Platform } from 'react-native';
import { v4 as uuid } from 'uuid';
import { getLocalEnrollment, saveLocalEnrollment } from './biometrics/LocalEnrollmentStore';
import { FACEGUARD_CONFIG } from './config';
import { LivenessEngine } from './liveness/LivenessEngine';
import { ModelAdapter, SimulatedTfliteAdapter } from './model/ModelAdapter';
import { PhotoBasedModelAdapter } from './model/PhotoBasedModelAdapter';
import { TfliteModelAdapter } from './model/TfliteModelAdapter';
import { cosineSimilarity } from './model/vector';
import { SAMPLE_IDENTITIES } from './sampleIdentities';
import {
  EnrolledIdentity,
  FaceAuthFailure,
  FaceAuthResult,
  FaceMatchResult,
  FrameSample,
  LivenessChallenge
} from '../types/faceguard';

export type AuthenticateOptions = {
  frames: FrameSample[];
  challenges?: LivenessChallenge[];
  threshold?: number;
  deviceId: string;
  useLocalEnrollment?: boolean;
};

const LOCAL_MATCH_THRESHOLD = 0.82;

export function createDefaultModelAdapter(): ModelAdapter {
  // Native TFLite crashes on many Android devices during model.run(); use the
  // photo pipeline there. iOS uses BlazeFace + MobileFaceNet when available.
  if (Platform.OS === 'android') {
    return new PhotoBasedModelAdapter();
  }
  return new TfliteModelAdapter();
}

export class FaceGuardEngine {
  private readonly liveness = new LivenessEngine();
  private initialized = false;

  constructor(
    private readonly modelAdapter: ModelAdapter = createDefaultModelAdapter(),
    private readonly identities: EnrolledIdentity[] = SAMPLE_IDENTITIES
  ) {}

  async initialize(): Promise<void> {
    await this.modelAdapter.initialize();
    this.initialized = true;
  }

  async enrollFromFrames(frames: FrameSample[], userId = 'DL-FIELD-LOCAL', name = 'Local Field User'): Promise<void> {
    if (!this.initialized) {
      throw this.failure('MODEL_UNAVAILABLE', 'FaceGuard models are not initialized.');
    }

    const prepared = await this.prepareFrames(frames);
    const faceFrame = prepared.find(frame => frame.face);
    if (!faceFrame?.face) {
      throw this.failure('NO_FACE', 'No usable face was detected. Center your face and try again.');
    }

    if (faceFrame.luminance < 0.18) {
      throw this.failure('LOW_LIGHT', 'Lighting is too low for enrollment.');
    }

    const embedding = await this.modelAdapter.createEmbedding(faceFrame, faceFrame.face);
    await saveLocalEnrollment({
      userId,
      name,
      embedding,
      enrolledAt: new Date().toISOString()
    });
  }

  async authenticate(options: AuthenticateOptions): Promise<FaceAuthResult> {
    if (!this.initialized) {
      throw this.failure('MODEL_UNAVAILABLE', 'FaceGuard models are not initialized.');
    }

    const started = Date.now();
    const frames = await this.prepareFrames(options.frames);
    const faceFrame = frames.find(frame => frame.face);

    if (!faceFrame?.face) {
      throw this.failure('NO_FACE', 'No usable face was detected in the camera frame.');
    }

    if (faceFrame.luminance < 0.18) {
      throw this.failure('LOW_LIGHT', 'Lighting is too low for reliable authentication.');
    }

    const challenges = options.challenges ?? FACEGUARD_CONFIG.defaultChallenges;
    const livenessResult = this.liveness.evaluate(frames, challenges);
    if (!livenessResult.passed) {
      throw this.failure('LIVENESS_FAILED', livenessResult.reason ?? 'Liveness failed.');
    }

    const embedding = await this.modelAdapter.createEmbedding(faceFrame, faceFrame.face);
    const threshold = options.threshold ?? FACEGUARD_CONFIG.authThreshold;
    const useLocal = options.useLocalEnrollment ?? true;

    const match = useLocal
      ? await this.matchLocal(embedding, threshold)
      : this.matchSampleIdentities(embedding, threshold);

    if (!match.matched || !match.userId) {
      throw this.failure('MATCH_FAILED', 'Face did not match an enrolled field personnel profile.');
    }

    const durationMs = Date.now() - started;
    if (durationMs > FACEGUARD_CONFIG.maxAuthDurationMs) {
      throw this.failure('TIMEOUT', 'Authentication exceeded the one-second target.');
    }

    return {
      id: uuid(),
      userId: match.userId,
      matched: true,
      score: match.score,
      livenessScore: livenessResult.score,
      modelVersion: FACEGUARD_CONFIG.modelVersion,
      createdAt: new Date().toISOString(),
      deviceId: options.deviceId,
      durationMs
    };
  }

  private async prepareFrames(frames: FrameSample[]): Promise<FrameSample[]> {
    return Promise.all(
      frames.map(async frame => ({
        ...frame,
        face: frame.face ?? (await this.modelAdapter.detectFace(frame)),
        textureScore: frame.textureScore || (await this.modelAdapter.estimateTextureLiveness(frame))
      }))
    );
  }

  private async matchLocal(embedding: number[], threshold: number): Promise<FaceMatchResult> {
    const enrollment = await getLocalEnrollment();
    if (!enrollment) {
      return { matched: false, score: 0, threshold };
    }

    const enrollmentVector = enrollment.embedding ?? enrollment.descriptor?.vector;
    if (!enrollmentVector) {
      return { matched: false, score: 0, threshold };
    }

    const score = Number(cosineSimilarity(embedding, enrollmentVector).toFixed(4));
    const effectiveThreshold = Math.max(threshold, LOCAL_MATCH_THRESHOLD);
    return {
      matched: score >= effectiveThreshold,
      userId: enrollment.userId,
      score,
      threshold: effectiveThreshold
    };
  }

  private matchSampleIdentities(embedding: number[], threshold: number): FaceMatchResult {
    const best = this.identities
      .map(identity => ({
        identity,
        score: cosineSimilarity(embedding, identity.embedding)
      }))
      .sort((a, b) => b.score - a.score)[0];

    return {
      matched: Boolean(best && best.score >= threshold),
      userId: best?.identity.userId,
      score: Number((best?.score ?? 0).toFixed(4)),
      threshold
    };
  }

  private failure(code: FaceAuthFailure['code'], reason: string): FaceAuthFailure {
    return { code, reason };
  }
}

/** @deprecated Use createDefaultModelAdapter() for new integrations. */
export { SimulatedTfliteAdapter };
