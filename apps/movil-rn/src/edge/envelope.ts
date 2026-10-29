import type { Track } from './tracker';

export const edgeNodeVersion = 'movil-1.4.0';

export interface DetectionEnvelope {
  schemaVersion: '1.1';
  eventId: string;
  sessionId: string;
  sequenceNumber: number;
  cameraId: string;
  generatedAt: string;
  nodeVersion: string;
  model: string;
  modelVersion: string;
  modelDigest: string | null;
  frameNumber: number;
  detections: {
    trackId: number;
    vehicleType: string;
    confidence: number;
    firstSeen: string;
    lastSeen: string;
    direction: string;
    boundingBox: [number, number, number, number];
    color: string | null;
    make: null;
    model: null;
    licensePlate: null;
  }[];
}

export function uuidV4(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 16) throw new RangeError('Se requieren 16 bytes aleatorios para UUIDv4.');
  const bytes = Uint8Array.from(randomBytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isoUtc(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

export function buildEnvelope(input: {
  cameraId: string;
  sessionId: string;
  sequenceNumber: number;
  frameNumber: number;
  modelName: string;
  modelDigest: string | null;
  tracks: Track[];
  generatedAt: number;
  eventId: string;
}): DetectionEnvelope {
  return {
    schemaVersion: '1.1',
    eventId: input.eventId,
    sessionId: input.sessionId,
    sequenceNumber: input.sequenceNumber,
    cameraId: input.cameraId,
    generatedAt: isoUtc(input.generatedAt),
    nodeVersion: edgeNodeVersion,
    model: input.modelName,
    modelVersion: input.modelName,
    modelDigest: input.modelDigest,
    frameNumber: input.frameNumber,
    detections: input.tracks.map((track) => ({
      trackId: track.id,
      vehicleType: track.label,
      confidence: Number(track.bestScore.toFixed(4)),
      firstSeen: isoUtc(track.firstSeen),
      lastSeen: isoUtc(track.lastSeen),
      direction: track.direction,
      boundingBox: [track.box.x1, track.box.y1, track.box.x2, track.box.y2].map((value) => Math.max(0, Math.round(value))) as [number, number, number, number],
      color: track.colorVotes.color,
      make: null,
      model: null,
      licensePlate: null,
    })),
  };
}
