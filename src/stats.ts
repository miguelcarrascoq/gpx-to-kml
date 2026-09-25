/**
 * Track / file metrics derived from parsed GPX and generated KML.
 */

import type { GpxData, TrackPoint } from "./converter";

const EARTH_RADIUS_M = 6_371_000;

export interface TrackMetrics {
  distanceM: number;
  elevMinM: number | null;
  elevMaxM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  durationMs: number | null;
  hasElevation: boolean;
}

export interface InputFileStats {
  fileName: string;
  fileSizeBytes: number;
  trackCount: number;
  routeCount: number;
  waypointCount: number;
  pointCount: number;
  metrics: TrackMetrics;
}

export interface OutputFileStats {
  fileName: string;
  fileSizeBytes: number;
  placemarkCount: number;
}

export interface ProfileSample {
  index: number;
  point: TrackPoint;
  distanceM: number;
  ele: number;
}

/** Haversine distance in metres between two WGS84 points. */
export function haversineM(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Flatten tracks (all segments) then routes into a single path for metrics. */
export function flattenPathPoints(data: GpxData): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const trk of data.tracks) {
    for (const seg of trk.segments) {
      for (const p of seg) points.push(p);
    }
  }
  for (const rte of data.routes) {
    for (const p of rte.points) points.push(p);
  }
  return points;
}

export function pathDistanceM(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    total += haversineM(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
}

/**
 * Cumulative ascent / descent. Small consecutive deltas under `noiseM` are
 * ignored to reduce GPS jitter (default 3 m).
 */
export function elevationGainLoss(
  elevations: number[],
  noiseM = 3
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let last = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    const ele = elevations[i];
    const delta = ele - last;
    if (Math.abs(delta) < noiseM) continue;
    if (delta > 0) gain += delta;
    else loss += -delta;
    last = ele;
  }
  return { gain, loss };
}

export function durationMsFromPoints(points: TrackPoint[]): number | null {
  const times = points
    .map((p) => (p.time ? Date.parse(p.time) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const ms = max - min;
  return ms > 0 ? ms : null;
}

export function computeTrackMetrics(data: GpxData): TrackMetrics {
  const points = flattenPathPoints(data);
  const distanceM = pathDistanceM(points);
  const elevs = points
    .map((p) => p.ele)
    .filter((e): e is number => e != null && Number.isFinite(e));
  const hasElevation = elevs.length > 0;
  let elevMinM: number | null = null;
  let elevMaxM: number | null = null;
  let elevGainM: number | null = null;
  let elevLossM: number | null = null;
  if (hasElevation) {
    elevMinM = Math.min(...elevs);
    elevMaxM = Math.max(...elevs);
    const { gain, loss } = elevationGainLoss(elevs);
    elevGainM = gain;
    elevLossM = loss;
  }
  return {
    distanceM,
    elevMinM,
    elevMaxM,
    elevGainM,
    elevLossM,
    durationMs: durationMsFromPoints(points),
    hasElevation,
  };
}

export function countPlacemarks(data: GpxData): number {
  const trackSegs = data.tracks.reduce((n, t) => n + t.segments.length, 0);
  return trackSegs + data.routes.length + data.waypoints.length;
}

export function buildInputStats(file: File, data: GpxData): InputFileStats {
  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    trackCount: data.tracks.length,
    routeCount: data.routes.length,
    waypointCount: data.waypoints.length,
    pointCount: data.pointCount,
    metrics: computeTrackMetrics(data),
  };
}

export function buildOutputStats(
  fileName: string,
  kml: string,
  data: GpxData
): OutputFileStats {
  return {
    fileName,
    fileSizeBytes: new TextEncoder().encode(kml).length,
    placemarkCount: countPlacemarks(data),
  };
}

/**
 * Build elevation-profile samples (distance along path, elevation).
 * Points without elevation are skipped for the Y series but still advance distance.
 * Returns empty if fewer than 2 points with elevation.
 */
export function buildProfileSamples(data: GpxData): ProfileSample[] {
  const points = flattenPathPoints(data);
  if (points.length < 2) return [];

  const samples: ProfileSample[] = [];
  let distanceM = 0;
  let sampleIndex = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const a = points[i - 1];
      const b = points[i];
      distanceM += haversineM(a.lat, a.lon, b.lat, b.lon);
    }
    const p = points[i];
    if (p.ele == null || !Number.isFinite(p.ele)) continue;
    samples.push({
      index: sampleIndex++,
      point: p,
      distanceM,
      ele: p.ele,
    });
  }

  return samples.length >= 2 ? samples : [];
}

/** Index of the path point nearest to a lat/lon (among flattenPathPoints). */
export function nearestPathIndex(
  data: GpxData,
  lat: number,
  lon: number
): number {
  const points = flattenPathPoints(data);
  if (!points.length) return -1;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const d = haversineM(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km`;
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}h ${min}m`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}
