import { gpxToKml } from "./converter";
import { clearPreview, showPreview } from "./map";
import {
  buildInputStats,
  buildOutputStats,
  formatBytes,
  formatDistance,
  formatDuration,
  formatElevation,
  type InputFileStats,
  type OutputFileStats,
} from "./stats";
import "./styles.css";

const dropzone = document.getElementById("dropzone") as HTMLElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const resultsEl = document.getElementById("results") as HTMLElement;
const inputStatsEl = document.getElementById("inputStats") as HTMLElement;
const outputStatsEl = document.getElementById("outputStats") as HTMLElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const errorEl = document.getElementById("error") as HTMLElement;
const mapEl = document.getElementById("map") as HTMLElement;

let lastKml: string | null = null;
let lastName = "track.kml";

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
    appendStat(
      inputStatsEl,
      "Tracks",
      String(stats.trackCount)
    );
  }
  if (stats.routeCount) {
    appendStat(
      inputStatsEl,
      "Routes",
      String(stats.routeCount)
    );
  }
  if (stats.waypointCount) {
    appendStat(
      inputStatsEl,
      "Waypoints",
      String(stats.waypointCount)
    );
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

function baseName(filename: string): string {
  return filename.replace(/\.gpx$/i, "") || "track";
}

async function handleFile(file: File | undefined | null): Promise<void> {
  showError("");
  clearResults();
  clearPreview(mapEl);
  lastKml = null;

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

    const input = buildInputStats(file, data);
    const output = buildOutputStats(lastName, kml, data);
    showResults(input, output);
    showPreview(mapEl, data);
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
