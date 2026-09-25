import { gpxToKml } from "./converter.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const downloadBtn = document.getElementById("downloadBtn");
const errorEl = document.getElementById("error");

let lastKml = null;
let lastName = "track.kml";

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function setStatus(message, canDownload) {
  statusEl.hidden = !message;
  statusText.textContent = message || "";
  downloadBtn.hidden = !canDownload;
}

function baseName(filename) {
  return filename.replace(/\.gpx$/i, "") || "track";
}

async function handleFile(file) {
  showError("");
  setStatus("", false);
  lastKml = null;

  if (!file) return;

  const looksGpx =
    /\.gpx$/i.test(file.name) ||
    /gpx|xml/i.test(file.type || "");

  if (!looksGpx) {
    showError("Elige un archivo con extensión .gpx");
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
      `${data.pointCount.toLocaleString("es")} puntos`,
      tracks ? `${tracks} track${tracks === 1 ? "" : "s"}` : null,
      routes ? `${routes} ruta${routes === 1 ? "" : "s"}` : null,
      waypoints ? `${waypoints} waypoint${waypoints === 1 ? "" : "s"}` : null,
    ].filter(Boolean);

    setStatus(`${file.name} → ${parts.join(" · ")}`, true);
  } catch (err) {
    showError(err.message || "No se pudo convertir el archivo");
  }
}

function openPicker() {
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
  const file = fileInput.files && fileInput.files[0];
  handleFile(file);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
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
