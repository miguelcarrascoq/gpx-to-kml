import { gpxToKml } from "./converter";
import "./styles.css";

const dropzone = document.getElementById("dropzone") as HTMLElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLElement;
const statusText = document.getElementById("statusText") as HTMLElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const errorEl = document.getElementById("error") as HTMLElement;

let lastKml: string | null = null;
let lastName = "track.kml";

function showError(message: string): void {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function setStatus(message: string, canDownload: boolean): void {
  statusEl.hidden = !message;
  statusText.textContent = message || "";
  downloadBtn.hidden = !canDownload;
}

function baseName(filename: string): string {
  return filename.replace(/\.gpx$/i, "") || "track";
}

async function handleFile(file: File | undefined | null): Promise<void> {
  showError("");
  setStatus("", false);
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

    const tracks = data.tracks.length;
    const routes = data.routes.length;
    const waypoints = data.waypoints.length;
    const parts = [
      `${data.pointCount.toLocaleString("en")} points`,
      tracks ? `${tracks} track${tracks === 1 ? "" : "s"}` : null,
      routes ? `${routes} route${routes === 1 ? "" : "s"}` : null,
      waypoints
        ? `${waypoints} waypoint${waypoints === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);

    setStatus(`${file.name} → ${parts.join(" · ")}`, true);
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
