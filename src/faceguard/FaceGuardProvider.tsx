import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { FaceGuardEngine } from './FaceGuardEngine';
import { OfflineQueue } from './storage/OfflineQueue';
import { SyncService } from './sync/SyncService';

type FaceGuardContextValue = {
  queue: OfflineQueue;
  syncService: SyncService;
  engine: FaceGuardEngine;
  ready: boolean;
  initError: string | null;
  ensureEngineReady: () => Promise<void>;
};

const FaceGuardContext = createContext<FaceGuardContextValue | undefined>(undefined);

export function FaceGuardProvider({ children }: PropsWithChildren) {
  const queue = useMemo(() => new OfflineQueue(), []);
  const syncService = useMemo(() => new SyncService(queue), [queue]);
  const engine = useMemo(() => new FaceGuardEngine(), []);
  const engineReadyRef = useRef(false);
  const engineInitRef = useRef<Promise<void> | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await queue.initialize();
        if (mounted) {
          setInitError(null);
          setReady(true);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Offline storage failed to initialize.';
        console.error('QUEUE INIT ERROR:', error);
        if (mounted) {
          setInitError(message);
          setReady(false);
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [queue]);

  const ensureEngineReady = useCallback(async () => {
    if (engineReadyRef.current) {
      return;
    }

    if (!engineInitRef.current) {
      engineInitRef.current = engine.initialize().then(() => {
        engineReadyRef.current = true;
      });
    }

    await engineInitRef.current;
  }, [engine]);

  return (
    <FaceGuardContext.Provider
      value={{ queue, syncService, engine, ready, initError, ensureEngineReady }}
    >
      {children}
    </FaceGuardContext.Provider>
  );
}

export function useFaceGuardContext(): FaceGuardContextValue {
  const context = useContext(FaceGuardContext);
  if (!context) {
    throw new Error('useFaceGuardContext must be used inside FaceGuardProvider.');
  }
  return context;
}
