import { z } from 'zod';

const manifestSchema = z.object({
  schema: z.literal('vigia-mobile-model/1'),
  task: z.enum(['detect', 'classify', 'ocr']).default('detect'),
  source: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  input: z.object({
    shape: z.array(z.number().int()).length(4),
    dtype: z.enum(['float32', 'uint8']),
    layout: z.enum(['NCHW', 'NHWC']),
    range: z.tuple([z.number(), z.number()]),
  }),
  output: z.object({
    shape: z.array(z.number().int()).min(2),
    dtype: z.literal('float32'),
  }),
  labels: z.record(z.string(), z.string()).optional(),
  // OCR only (apps/vision/training/export_plate_ocr.py).
  alphabet: z.string().min(2).optional(),
  padChar: z.string().length(1).optional(),
  slots: z.number().int().positive().optional(),
});

export type ModelManifest = z.infer<typeof manifestSchema> & { name: string };

/** The models the app ships, each with the exact shape it was exported with. */
export type ModelKind = 'vehicles' | 'colors' | 'plates' | 'ocr';

const expected: Record<ModelKind, {
  task: ModelManifest['task'];
  layout: 'NCHW' | 'NHWC';
  dtype: 'float32' | 'uint8';
  input: number[];
  output: number[];
  labels?: Record<string, string>;
}> = {
  vehicles: { task: 'detect', layout: 'NCHW', dtype: 'float32', input: [1, 3, 320, 320], output: [1, 300, 6], labels: { 2: 'car', 3: 'motorcycle' } },
  colors: {
    task: 'classify',
    layout: 'NCHW',
    dtype: 'float32',
    input: [1, 3, 128, 128],
    output: [1, 8],
    labels: { 0: 'black', 1: 'blue', 2: 'brown', 3: 'gray', 4: 'green', 5: 'red', 6: 'white', 7: 'yellow' },
  },
  plates: { task: 'detect', layout: 'NCHW', dtype: 'float32', input: [1, 3, 320, 320], output: [1, 300, 6], labels: { 0: 'plate' } },
  ocr: { task: 'ocr', layout: 'NHWC', dtype: 'uint8', input: [1, 64, 128, 3], output: [1, 10, 37] },
};

export function parseModelManifest(value: unknown, kind: ModelKind): ModelManifest {
  const parsed = manifestSchema.parse(value);
  const want = expected[kind];
  if (parsed.task !== want.task) throw new Error(`El manifiesto no corresponde a la tarea ${want.task}.`);
  const labelsMatch = want.labels
    ? JSON.stringify(parsed.labels) === JSON.stringify(want.labels)
    : !!parsed.alphabet && !!parsed.padChar && parsed.alphabet.length === parsed.output.shape[2]
      && parsed.slots === parsed.output.shape[1] && parsed.alphabet.includes(parsed.padChar);
  if (parsed.input.layout !== want.layout
    || parsed.input.dtype !== want.dtype
    || !sameShape(parsed.input.shape, want.input)
    || !sameShape(parsed.output.shape, want.output)
    || !labelsMatch) {
    throw new Error('El manifiesto no coincide con la forma o las etiquetas del modelo VIGÍA esperado.');
  }
  return { ...parsed, name: parsed.source.replace(/\.(pt|onnx)$/i, '') };
}

function sameShape(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
