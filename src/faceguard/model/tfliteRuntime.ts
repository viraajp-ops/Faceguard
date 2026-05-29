export type TfliteRuntimeModule = typeof import('react-native-fast-tflite');

let cachedRuntime: TfliteRuntimeModule | null | undefined;

/**
 * Load react-native-fast-tflite only when needed so a missing/broken native
 * module does not crash the app at import time.
 */
export function getTfliteRuntime(): TfliteRuntimeModule | null {
  if (cachedRuntime !== undefined) {
    return cachedRuntime;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedRuntime = require('react-native-fast-tflite') as TfliteRuntimeModule;
  } catch (error) {
    console.warn('react-native-fast-tflite is not available on this build.', error);
    cachedRuntime = null;
  }

  return cachedRuntime;
}
