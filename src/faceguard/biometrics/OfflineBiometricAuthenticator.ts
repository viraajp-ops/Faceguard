import { v4 as uuid } from 'uuid';
import { FaceAuthFailure, FaceAuthResult } from '../../types/faceguard';
import {
  PhotoDescriptor,
  comparePhotoDescriptors,
  createPhotoDescriptor,
  estimateSequenceLiveness
} from './PhotoDescriptor';
import { getLocalEnrollment, saveLocalEnrollment } from './LocalEnrollmentStore';
import { FACEGUARD_CONFIG } from '../config';

const LOCAL_MATCH_THRESHOLD = 0.74;
const LOCAL_LIVENESS_THRESHOLD = 0.12;

export async function hasLocalEnrollment(): Promise<boolean> {
  return Boolean(await getLocalEnrollment());
}

export async function enrollLocalFace(photoPaths: string[] | string): Promise<void> {
  const captures = Array.isArray(photoPaths) ? photoPaths : [photoPaths];
  const descriptors = await Promise.all(captures.map(path => createPhotoDescriptor(path)));
  const descriptor = mergeDescriptors(descriptors);
  if (descriptor.qualityScore < 0.08) {
    throw failure('NO_FACE', 'Captured image quality is too low. Try again with your face centered.');
  }

  await saveLocalEnrollment({
    userId: 'DL-FIELD-LOCAL',
    name: 'Local Field User',
    descriptor,
    enrolledAt: new Date().toISOString()
  });
}

export async function authenticateLocalFace(
  photoPaths: string[],
  deviceId: string
): Promise<FaceAuthResult> {
  const started = Date.now();
  const enrollment = await getLocalEnrollment();
  if (!enrollment) {
    throw failure('MATCH_FAILED', 'No offline enrollment found. Enroll your face first.');
  }

  if (!enrollment.descriptor) {
    throw failure('MATCH_FAILED', 'Saved offline enrollment is incomplete. Re-enroll your face.');
  }

  const enrollmentDescriptor = enrollment.descriptor;

  const descriptors = await Promise.all(photoPaths.map(path => createPhotoDescriptor(path)));
  if (descriptors.length === 0) {
    throw failure('NO_FACE', 'No capture was available for authentication.');
  }

  const livenessScore = estimateSequenceLiveness(descriptors);
  if (livenessScore < LOCAL_LIVENESS_THRESHOLD) {
    throw failure('LIVENESS_FAILED', 'Move naturally during the challenge. The app did not detect enough live variation.');
  }

  const score = Math.max(
    ...descriptors.map(descriptor => comparePhotoDescriptors(enrollmentDescriptor, descriptor))
  );
  if (score < LOCAL_MATCH_THRESHOLD) {
    throw failure('MATCH_FAILED', `Face did not match the offline enrollment. Score ${score}.`);
  }

  return {
    id: uuid(),
    userId: enrollment.userId,
    matched: true,
    score,
    livenessScore,
    modelVersion: `${FACEGUARD_CONFIG.modelVersion}-local-template`,
    createdAt: new Date().toISOString(),
    deviceId,
    durationMs: Date.now() - started
  };
}

function failure(code: FaceAuthFailure['code'], reason: string): FaceAuthFailure {
  return { code, reason };
}

function mergeDescriptors(descriptors: PhotoDescriptor[]): PhotoDescriptor {
  const count = Math.max(descriptors.length, 1);
  const vectorLength = descriptors[0]?.vector.length ?? 0;
  const vector = Array.from({ length: vectorLength }, (_, index) => {
    const sum = descriptors.reduce((accumulator, descriptor) => accumulator + (descriptor.vector[index] ?? 0), 0);
    return sum / count;
  });

  return {
    vector,
    qualityScore: descriptors.reduce((sum, descriptor) => sum + descriptor.qualityScore, 0) / count,
    byteLength: Math.round(descriptors.reduce((sum, descriptor) => sum + descriptor.byteLength, 0) / count)
  };
}
