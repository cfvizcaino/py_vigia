import "server-only";

import path from "node:path";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

export type PlateBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FRAME_NAME = /^frame-\d{6}\.(?:jpe?g|png)$/i;

function datasetRoot() {
  return process.env.VIGIA_PLATE_DATASET_DIR
    ? path.resolve(process.env.VIGIA_PLATE_DATASET_DIR)
    : path.resolve(process.cwd(), "../vision/datasets/plates/source_phone_01");
}

function assertFrameName(filename: string) {
  if (!FRAME_NAME.test(filename) || path.basename(filename) !== filename) {
    throw new Error("INVALID_FRAME_NAME");
  }
}

export function framePath(filename: string) {
  assertFrameName(filename);
  return path.join(datasetRoot(), "images", "raw", filename);
}

function labelPath(filename: string) {
  assertFrameName(filename);
  return path.join(datasetRoot(), "labels", "raw", `${path.parse(filename).name}.txt`);
}

async function fileExists(filename: string) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

export async function listFrames() {
  const imagesDir = path.join(datasetRoot(), "images", "raw");
  const names = (await readdir(imagesDir)).filter((name) => FRAME_NAME.test(name)).sort();

  return Promise.all(
    names.map(async (name) => {
      const annotation = labelPath(name);
      const annotated = await fileExists(annotation);
      const contents = annotated ? await readFile(annotation, "utf8") : "";
      const boxCount = contents.split("\n").filter((line) => line.trim()).length;
      return { name, annotated, boxCount };
    }),
  );
}

function validBox(box: unknown): box is PlateBox {
  if (!box || typeof box !== "object") return false;
  const candidate = box as Record<string, unknown>;
  const values = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return false;

  const { x, y, width, height } = candidate as PlateBox;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001;
}

export function validateBoxes(value: unknown): PlateBox[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every(validBox)) {
    throw new Error("INVALID_BOXES");
  }
  return value;
}

export async function readBoxes(filename: string): Promise<{ annotated: boolean; boxes: PlateBox[] }> {
  const annotation = labelPath(filename);
  if (!(await fileExists(annotation))) return { annotated: false, boxes: [] };

  const contents = await readFile(annotation, "utf8");
  const boxes = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [classId, centerX, centerY, width, height] = line.split(/\s+/).map(Number);
      if (classId !== 0 || ![centerX, centerY, width, height].every(Number.isFinite)) return [];
      const box = { x: centerX - width / 2, y: centerY - height / 2, width, height };
      return validBox(box) ? [box] : [];
    });

  return { annotated: true, boxes };
}

export async function saveBoxes(filename: string, boxes: PlateBox[]) {
  await access(framePath(filename));
  const annotation = labelPath(filename);
  await mkdir(path.dirname(annotation), { recursive: true });

  const contents = boxes
    .map(({ x, y, width, height }) => {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      return `0 ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
    })
    .join("\n");
  const temporary = `${annotation}.${process.pid}.tmp`;
  await writeFile(temporary, contents ? `${contents}\n` : "", "utf8");
  await rename(temporary, annotation);
}
