import L from "leaflet";
import type { Map as LeafletMap, LayerGroup, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GpxData, TrackPoint } from "./converter";

const TRACK_COLOR = "#0d6e56";
const ROUTE_COLOR = "#1a6f9b";

let map: LeafletMap | null = null;
let overlay: LayerGroup | null = null;

function ensureMap(container: HTMLElement): LeafletMap {
  if (map) return map;

  map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  }).setView([0, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  overlay = L.layerGroup().addTo(map);
  return map;
}

function toLatLngs(points: TrackPoint[]): LatLngExpression[] {
  return points.map((p) => [p.lat, p.lon]);
}

export function clearPreview(container: HTMLElement): void {
  container.hidden = true;
  overlay?.clearLayers();
}

export function showPreview(container: HTMLElement, data: GpxData): void {
  container.hidden = false;
  const leafletMap = ensureMap(container);
  overlay?.clearLayers();

  const bounds = L.latLngBounds([]);

  for (const trk of data.tracks) {
    for (const seg of trk.segments) {
      if (seg.length < 2) continue;
      const line = L.polyline(toLatLngs(seg), {
        color: TRACK_COLOR,
        weight: 4,
        opacity: 0.9,
      });
      overlay?.addLayer(line);
      bounds.extend(line.getBounds());
    }
  }

  for (const rte of data.routes) {
    if (rte.points.length < 2) continue;
    const line = L.polyline(toLatLngs(rte.points), {
      color: ROUTE_COLOR,
      weight: 4,
      opacity: 0.9,
      dashArray: "8 6",
    });
    overlay?.addLayer(line);
    bounds.extend(line.getBounds());
  }

  for (const wpt of data.waypoints) {
    const marker = L.circleMarker([wpt.lat, wpt.lon], {
      radius: 6,
      color: "#085241",
      fillColor: "#0d6e56",
      fillOpacity: 0.95,
      weight: 2,
    });
    if (wpt.name) marker.bindPopup(wpt.name);
    overlay?.addLayer(marker);
    bounds.extend([wpt.lat, wpt.lon]);
  }

  requestAnimationFrame(() => {
    leafletMap.invalidateSize();
    if (bounds.isValid()) {
      leafletMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }
  });
}
