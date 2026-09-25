import type { GpxData } from "./converter";
import { gpxToKml } from "./converter";
import { ElevationProfile } from "./elevation";
import {
  clearPreview,
  clearScrubMarker,
  DEFAULT_TRACK_COLOR,
  getTrackColor,
  setMapClickHandler,
  setMapHoverHandler,
  setScrubMarker,
  setTrackColor,
  showPreview,
} from "./map";
import {
  buildInputStats,
  buildOutputStats,
  buildProfileSamples,
  formatBytes,
  formatDistance,
  formatDuration,
  formatElevation,
  nearestPathIndex,
  nearestSampleByPathIndex,
  type InputFileStats,
  type OutputFileStats,
  type ProfileSample,
} from "./stats";
import "./styles.css";

const EXAMPLE_GPX_PATH = `${import.meta.env.BASE_URL}examples/temucoCity-llaimaVolcano.gpx`;
const EXAMPLE_GPX_NAME = "temucoCity-llaimaVolcano.gpx";

const dropzone = document.getElementById("dropzone") as HTMLElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const loadExampleBtn = document.getElementById(
  "loadExample",
) as HTMLButtonElement;
const resultsEl = document.getElementById("results") as HTMLElement;
const inputStatsEl = document.getElementById("inputStats") as HTMLElement;
const outputStatsEl = document.getElementById("outputStats") as HTMLElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const errorEl = document.getElementById("error") as HTMLElement;
const mapEl = document.getElementById("map") as HTMLElement;
const elevationEl = document.getElementById("elevation") as HTMLElement;
const trackColorEl = document.getElementById("trackColor") as HTMLElement;
const trackColorCustom = document.getElementById(
  "trackColorCustom",
) as HTMLInputElement;

const elevationProfile = new ElevationProfile(elevationEl);

let lastKml: string | null = null;
let lastName = "track.kml";
let lastData: GpxData | null = null;
let lastSamples: ProfileSample[] = [];

function normalizeHex(color: string): string {
  return color.trim().toLowerCase();
}

function syncTrackColorUI(color: string): void {
  const hex = normalizeHex(color);
  trackColorCustom.value = hex;
  for (const btn of trackColorEl.querySelectorAll<HTMLButtonElement>(
    ".track-swatch[data-color]",
  )) {
    const active = normalizeHex(btn.dataset.color || "") === hex;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function applyTrackColor(color: string): void {
  const hex = normalizeHex(color);
  if (!/^#[0-9a-f]{6}$/.test(hex)) return;
  setTrackColor(hex);
  syncTrackColorUI(getTrackColor());
}

trackColorEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
    ".track-swatch[data-color]",
  );
  if (!btn?.dataset.color) return;
  applyTrackColor(btn.dataset.color);
});

trackColorCustom.addEventListener("input", () => {
  applyTrackColor(trackColorCustom.value);
});

syncTrackColorUI(DEFAULT_TRACK_COLOR);

function showError(message: string): void {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function clearResults(): void {
  resultsEl.hidden = true;
  inputStatsEl.replaceChildren();
  outputStatsEl.replaceChildren();
}

function appendStat(dl: HTMLElement, label: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderInputStats(stats: InputFileStats): void {
  inputStatsEl.replaceChildren();
  appendStat(inputStatsEl, "File", stats.fileName);
  appendStat(inputStatsEl, "Size", formatBytes(stats.fileSizeBytes));
  appendStat(
    inputStatsEl,
    "Points",
    stats.pointCount.toLocaleString("en")
  );
  if (stats.trackCount) {
    appendStat(inputStatsEl, "Tracks", String(stats.trackCount));
  }
  if (stats.routeCount) {
    appendStat(inputStatsEl, "Routes", String(stats.routeCount));
  }
  if (stats.waypointCount) {
    appendStat(inputStatsEl, "Waypoints", String(stats.waypointCount));
  }
  const m = stats.metrics;
  if (m.distanceM > 0) {
    appendStat(inputStatsEl, "Distance", formatDistance(m.distanceM));
  }
  if (m.hasElevation && m.elevMinM != null && m.elevMaxM != null) {
    appendStat(
      inputStatsEl,
      "Elevation",
      `${formatElevation(m.elevMinM)} – ${formatElevation(m.elevMaxM)}`
    );
  }
  if (m.elevGainM != null && m.elevLossM != null) {
    appendStat(
      inputStatsEl,
      "Gain / loss",
      `+${formatElevation(m.elevGainM)} / −${formatElevation(m.elevLossM)}`
    );
  }
  if (m.durationMs != null) {
    appendStat(inputStatsEl, "Duration", formatDuration(m.durationMs));
  }
}

function renderOutputStats(stats: OutputFileStats): void {
  outputStatsEl.replaceChildren();
  appendStat(outputStatsEl, "File", stats.fileName);
  appendStat(outputStatsEl, "Size", formatBytes(stats.fileSizeBytes));
  appendStat(
    outputStatsEl,
    "Placemarks",
    stats.placemarkCount.toLocaleString("en")
  );
}

function showResults(input: InputFileStats, output: OutputFileStats): void {
  renderInputStats(input);
  renderOutputStats(output);
  resultsEl.hidden = false;
}

function onProfileScrub(sample: ProfileSample | null): void {
  if (!sample) {
    clearScrubMarker();
    return;
  }
  setScrubMarker(sample.point.lat, sample.point.lon);
}

function onMapClick(lat: number, lon: number): void {
  if (!lastData || !lastSamples.length) return;
  const pathIndex = nearestPathIndex(lastData, lat, lon);
  const sample = nearestSampleByPathIndex(lastSamples, pathIndex);
  if (!sample) return;
  elevationProfile.setActiveSample(sample);
  setScrubMarker(sample.point.lat, sample.point.lon);
}

function baseName(filename: string): string {
  return filename.replace(/\.gpx$/i, "") || "track";
}

async function handleFile(file: File | undefined | null): Promise<void> {
  showError("");
  clearResults();
  clearPreview(mapEl);
  elevationProfile.clear();
  lastKml = null;
  lastData = null;
  lastSamples = [];

  if (!file) return;

  const looksGpx =
    /\.gpx$/i.test(file.name) || /gpx|xml/i.test(file.type || "");

  if (!looksGpx) {
    showError("Choose a file with a .gpx extension");
    return;
  }

  try {
    const text = await file.text();
    const { kml, data } = gpxToKml(text);
    lastKml = kml;
    lastName = `${baseName(file.name)}.kml`;
    lastData = data;

    const input = buildInputStats(file, data);
    const output = buildOutputStats(lastName, kml, data);
    showResults(input, output);
    showPreview(mapEl, data);

    lastSamples = buildProfileSamples(data);
    elevationProfile.setOnScrub(onProfileScrub);
    elevationProfile.show(lastSamples);
    if (lastSamples.length) {
      setMapClickHandler(onMapClick);
      setMapHoverHandler(onMapClick);
    } else {
      setMapClickHandler(null);
      setMapHoverHandler(null);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not convert the file";
    showError(message);
  }
}

function openPicker(): void {
  fileInput.click();
}

dropzone.addEventListener("click", openPicker);
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openPicker();
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  void handleFile(file);
  fileInput.value = "";
});

(["dragenter", "dragover"] as const).forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("dragover");
  });
});

(["dragleave", "drop"] as const).forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  void handleFile(file);
});

async function loadExampleTrack(): Promise<void> {
  if (loadExampleBtn.disabled) return;

  loadExampleBtn.disabled = true;
  loadExampleBtn.classList.add("is-loading");
  showError("");

  try {
    const response = await fetch(EXAMPLE_GPX_PATH);
    if (!response.ok) {
      throw new Error(`Could not load sample track (${response.status})`);
    }
    const blob = await response.blob();
    const file = new File([blob], EXAMPLE_GPX_NAME, {
      type: "application/gpx+xml",
    });
    await handleFile(file);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load the sample track";
    showError(message);
  } finally {
    loadExampleBtn.disabled = false;
    loadExampleBtn.classList.remove("is-loading");
  }
}

loadExampleBtn.addEventListener("click", () => {
  void loadExampleTrack();
});

downloadBtn.addEventListener("click", () => {
  if (!lastKml) return;
  const blob = new Blob([lastKml], {
    type: "application/vnd.google-earth.kml+xml",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastName;
  a.click();
  URL.revokeObjectURL(url);
});
