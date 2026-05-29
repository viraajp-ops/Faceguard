declare module 'react-native-fast-tflite' {
  export type ModelSource = number | string | { uri: string } | { asset: number };
  export type TensorflowModelDelegate = 'default' | 'core-ml' | 'gpu' | 'nnapi';
  export type TensorflowModel = {
    run(inputs: ArrayBuffer[] | Uint8Array[]): Promise<ArrayBuffer[]>;
  };

  export function loadTensorflowModel(
    source: ModelSource,
    delegate?: TensorflowModelDelegate | TensorflowModelDelegate[]
  ): Promise<TensorflowModel>;
}
