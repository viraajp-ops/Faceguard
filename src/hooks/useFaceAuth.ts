import { useCallback, useEffect, useMemo, useState } from 'react';
import { FACEGUARD_CONFIG } from '../faceguard/config';
import {
  authenticateLocalFace,
  enrollLocalFace,
  hasLocalEnrollment
} from '../faceguard/biometrics/OfflineBiometricAuthenticator';
import { MlFaceAuthService } from '../faceguard/model/MlFaceAuthService';
import { AuthStatus, FaceAuthFailure, FaceAuthResult } from '../types/faceguard';
import { useFaceGuardContext } from '../faceguard/FaceGuardProvider';

export function useFaceAuth() {
  const { queue, ready } = useFaceGuardContext();
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [lastResult, setLastResult] = useState<FaceAuthResult | undefined>();
  const [lastError, setLastError] = useState<FaceAuthFailure | undefined>();
  const [enrolled, setEnrolled] = useState(false);
  const [mlReady, setMlReady] = useState(false);

  const ml = useMemo(
    () =>
      new MlFaceAuthService({
        faceDetector: require('../../models/blazeface-int8.tflite'),
        faceRecognizer: require('../../models/mobilefacenet-fp16.tflite'),
        antiSpoof: require('../../models/antispoof-texture-int8.tflite')
      }),
    []
  );

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        await ml.initialize();
        if (mounted) {
          setMlReady(true);
          setStatus('idle');
        }
      } catch (error) {
        console.warn('ML models unavailable, keeping offline fallback active.', error);
        if (mounted) {
          setMlReady(false);
          setStatus('idle');
        }
      }
    }
    void init();
    return () => {
      mounted = false;
    };
  }, [ml]);

  const refreshEnrollment = useCallback(async () => {
    setEnrolled(mlReady ? true : await hasLocalEnrollment());
  }, [mlReady]);

  useEffect(() => {
    refreshEnrollment();
  }, [refreshEnrollment]);

  const enroll = useCallback(
    async (photoPaths: string[] | string) => {
      if (!ready) {
        setStatus('initializing');
        return false;
      }

      setStatus('matching-face');
      setLastError(undefined);

      try {
        if (mlReady) {
          await ml.enroll(photoPaths);
        } else {
          await enrollLocalFace(photoPaths);
        }
        await refreshEnrollment();
        setStatus('success');
        return true;
      } catch (error) {
        setLastError(error as FaceAuthFailure);
        setStatus('failed');
        return false;
      }
    },
    [ml, ready, refreshEnrollment]
  );

  const authenticate = useCallback(
    async (photoPaths: string[]) => {
      if (!ready) {
        setStatus('initializing');
        return;
      }

      setStatus('checking-liveness');
      setLastError(undefined);

      try {
        const result = mlReady
          ? await ml.authenticate(photoPaths, 'offline-camera-device')
          : await authenticateLocalFace(photoPaths, 'offline-camera-device');
        await queue.enqueue(result);
        setLastResult(result);
        setStatus('success');
        return result;
      } catch (error) {
        const failure = error as FaceAuthFailure;
        setLastError(failure);
        setStatus('failed');
        return undefined;
      }
    },
    [ml, queue, ready]
  );

  return {
    status,
    ready: ready && (mlReady || FACEGUARD_CONFIG.modelVersion.length > 0),
    enrolled,
    lastResult,
    lastError,
    enroll,
    authenticate
  };
}
