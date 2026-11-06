import { Asset } from 'expo-asset';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { loadTensorflowModel } from 'react-native-fast-tflite';

import colorsAsset from '../../assets/models/colors.tflite';
import colorsManifest from '../../assets/models/colors.json';
import vehiclesAsset from '../../assets/models/vehicles.tflite';
import vehiclesManifest from '../../assets/models/vehicles.json';
import platesAsset from '../../assets/models/plates.tflite';
import platesManifest from '../../assets/models/plates.json';
import plateOcrAsset from '../../assets/models/plate-ocr.tflite';
import plateOcrManifest from '../../assets/models/plate-ocr.json';
import type { TfliteModel, TensorflowModelDelegate } from 'react-native-fast-tflite';
import { parseModelManifest } from './modelManifest';
import type { ModelKind, ModelManifest } from './modelManifest';

export interface LoadedModel {
  manifest: ModelManifest;
  model: TfliteModel;
}

export const loadVehicleModel = (delegates?: TensorflowModelDelegate[]) => loadModel({
  assetId: vehiclesAsset,
  manifestData: vehiclesManifest,
  kind: 'vehicles',
  ...(delegates ? { delegates } : {}),
});

export const loadColorModel = (delegates?: TensorflowModelDelegate[]) => loadModel({
  assetId: colorsAsset,
  manifestData: colorsManifest,
  kind: 'colors',
  ...(delegates ? { delegates } : {}),
});

/** Plate detector (YOLO26n on vehicle crops), searched inside confirmed vehicles. */
export const loadPlateModel = (delegates?: TensorflowModelDelegate[]) => loadModel({
  assetId: platesAsset,
  manifestData: platesManifest,
  kind: 'plates',
  ...(delegates ? { delegates } : {}),
});

/** Plate OCR (cct-xs-v2-global, 128×64 RGB uint8 → 10 characters). */
export const loadPlateOcrModel = (delegates?: TensorflowModelDelegate[]) => loadModel({
  assetId: plateOcrAsset,
  manifestData: plateOcrManifest,
  kind: 'ocr',
  ...(delegates ? { delegates } : {}),
});

export async function loadModel(input: {
  assetId: number;
  manifestData: unknown;
  kind: ModelKind;
  delegates?: TensorflowModelDelegate[];
}): Promise<LoadedModel> {
  const parsed = parseModelManifest(input.manifestData, input.kind);

  const asset = Asset.fromModule(input.assetId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('No fue posible resolver el archivo local del modelo.');
  const bytes = await new File(asset.localUri).bytes();
  const digest = toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  if (digest !== parsed.sha256.toLowerCase()) {
    throw new Error('La huella SHA-256 del modelo no coincide con su manifiesto.');
  }

  // Load the very file whose digest was just checked. Passing the module id
  // breaks in release builds: it resolves to a resource name, not a URL.
  const model = await loadTensorflowModel({ url: asset.localUri }, input.delegates ?? []);
  const tensorInput = model.inputs[0];
  const tensorOutput = model.outputs[0];
  if (!tensorInput || !tensorOutput
    || tensorInput.dataType !== parsed.input.dtype
    || !sameShape(tensorInput.shape, parsed.input.shape)
    || tensorOutput.dataType !== parsed.output.dtype
    || !sameShape(tensorOutput.shape, parsed.output.shape)) {
    throw new Error('Los tensores TFLite no coinciden con el manifiesto del modelo.');
  }
  return {
    manifest: parsed,
    model,
  };
}

function sameShape(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
