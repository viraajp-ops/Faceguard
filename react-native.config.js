/** @type {import('@react-native-community/cli-types').Config} */
module.exports = {
  dependencies: {
    // TFLite native code crashes on several Android devices during inference.
    // Android uses the JS photo-based pipeline; iOS keeps BlazeFace + MobileFaceNet.
    'react-native-fast-tflite': {
      platforms: {
        android: null
      }
    }
  }
};
