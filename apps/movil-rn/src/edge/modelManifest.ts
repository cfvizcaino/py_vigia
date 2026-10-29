import { z } from 'zod';

const manifestSchema = z.object({
  schema: z.literal('vigia-mobile-model/1'),
  task: z.enum(['detect', 'classify']).default('detect'),
  source: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  input: z.object({
    shape: z.array(z.number().int()).length(4),
    dtype: z.literal('float32'),
    layout: z.enum(['NCHW', 'NHWC']),
    range: z.tuple([z.number(), z.number()]),
  }),
  output: z.object({
    shape: z.array(z.number().int()).min(2),
    dtype: z.literal('float32'),
  }),
  labels: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0),
});

export type ModelManifest = z.infer<typeof manifestSchema> & { name: string };

export function parseModelManifest(value: unknown, expectedTask: 'detect' | 'classify'): ModelManifest {
  const parsed = manifestSchema.parse(value);
  if (parsed.task !== expectedTask) throw new Error(`El manifiesto no corresponde a la tarea ${expectedTask}.`);
  const expectedShape = expectedTask === 'detect' ? [1, 3, 320, 320] : [1, 3, 128, 128];
  const expectedOutput = expectedTask === 'detect' ? [1, 300, 6] : [1, 8];
  const expectedLabels = expectedTask === 'detect'
    ? { 2: 'car', 3: 'motorcycle' }
    : { 0: 'black', 1: 'blue', 2: 'brown', 3: 'gray', 4: 'green', 5: 'red', 6: 'white', 7: 'yellow' };
  if (parsed.input.layout !== 'NCHW'
    || !sameShape(parsed.input.shape, expectedShape)
    || !sameShape(parsed.output.shape, expectedOutput)
    || JSON.stringify(parsed.labels) !== JSON.stringify(expectedLabels)) {
    throw new Error('El manifiesto no coincide con la forma o las etiquetas del modelo VIGÍA esperado.');
  }
  return { ...parsed, name: parsed.source.replace(/\.pt$/i, '') };
}

function sameShape(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
