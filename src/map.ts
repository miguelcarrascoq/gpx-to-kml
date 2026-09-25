import L from "leaflet";
import type {
  Map as LeafletMap,
  LayerGroup,
  CircleMarker,
  LatLngExpression,
  LeafletMouseEvent,
  TileLayer,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GpxData, TrackPoint } from "./converter";

export const DEFAULT_TRACK_COLOR = "#0d6e56";
const CASING_COLOR = "#ffffff";
const CASING_WEIGHT = 8;
const LINE_WEIGHT = 4;
const ROUTE_COLOR = "#1a6f9b";
const SCRUB_COLOR = "#c45c26";

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI_ATTR =
  "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";
const ESRI_REF_ATTR =
  "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ";
const TOPO_ATTR =
  'Map data: ' +
  OSM_ATTR +
  ' contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

function esriImageryLayer(): TileLayer {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: ESRI_ATTR,
    },
  );
}

export type MapClickHandler = (lat: number, lon: number) => void;

let map: LeafletMap | null = null;
let overlay: LayerGroup | null = null;
let scrubMarker: CircleMarker | null = null;
let mapClickHandler: MapClickHandler | null = null;
let sizeObserver: ResizeObserver | null = null;
let trackColor = DEFAULT_TRACK_COLOR;
let lastPreviewData: GpxData | null = null;
let lastPreviewContainer: HTMLElement | null = null;

function ensureMap(container: HTMLElement): LeafletMap {
  if (map) return map;

  map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  }).setView([0, 0], 2);

  const streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: OSM_ATTR,
    },
  );

  const satellite = esriImageryLayer();

  const hybrid = L.layerGroup([
    esriImageryLayer(),
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: ESRI_REF_ATTR,
      },
    ),
  ]);

  const topographic = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 17,
      attribution: TOPO_ATTR,
    },
  );

  streets.addTo(map);

  L.control
    .layers(
      {
        Streets: streets,
        Satellite: satellite,
        Hybrid: hybrid,
        Topographic: topographic,
      },
      undefined,
      { position: "topright" },
    )
    .addTo(map);

  overlay = L.layerGroup().addTo(map);

  map.on("click", (e: LeafletMouseEvent) => {
    mapClickHandler?.(e.latlng.lat, e.latlng.lng);
  });

  sizeObserver = new ResizeObserver(() => {
    map?.invalidateSize({ animate: false });
  });
  sizeObserver.observe(container);

  window.addEventListener("resize", () => {
    map?.invalidateSize({ animate: false });
  });

  return map;
}

function toLatLngs(points: TrackPoint[]): LatLngExpression[] {
  return points.map((p) => [p.lat, p.lon]);
}

function darkenHex(hex: string, amount = 0.22): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = parseInt(raw, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function relativeLuminance(hex: string): number {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return 0;
  const n = parseInt(raw, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function casingFor(color: string): string {
  return relativeLuminance(color) > 0.72 ? "#1c2421" : CASING_COLOR;
}

function addCasedLine(
  latlngs: LatLngExpression[],
  color: string,
  dashArray?: string,
): L.LatLngBounds {
  const casing = L.polyline(latlngs, {
    color: casingFor(color),
    weight: CASING_WEIGHT,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    ...(dashArray ? { dashArray } : {}),
  });
  const line = L.polyline(latlngs, {
    color,
    weight: LINE_WEIGHT,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    ...(dashArray ? { dashArray } : {}),
  });
  overlay?.addLayer(casing);
  overlay?.addLayer(line);
  return line.getBounds();
}

function drawOverlay(data: GpxData): L.LatLngBounds {
  overlay?.clearLayers();
  const bounds = L.latLngBounds([]);

  for (const trk of data.tracks) {
    for (const seg of trk.segments) {
      if (seg.length < 2) continue;
      bounds.extend(addCasedLine(toLatLngs(seg), trackColor));
    }
  }

  for (const rte of data.routes) {
    if (rte.points.length < 2) continue;
    bounds.extend(
      addCasedLine(toLatLngs(rte.points), ROUTE_COLOR, "8 6"),
    );
  }

  for (const wpt of data.waypoints) {
    const marker = L.circleMarker([wpt.lat, wpt.lon], {
      radius: 6,
      color: darkenHex(trackColor),
      fillColor: trackColor,
      fillOpacity: 0.95,
      weight: 2,
    });
    if (wpt.name) marker.bindPopup(wpt.name);
    overlay?.addLayer(marker);
    bounds.extend([wpt.lat, wpt.lon]);
  }

  return bounds;
}

export function getTrackColor(): string {
  return trackColor;
}

export function setTrackColor(color: string): void {
  const next = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(next)) return;
  if (next === trackColor) return;
  trackColor = next;
  if (!lastPreviewData || !lastPreviewContainer) return;
  const wrap = lastPreviewContainer.closest(".map-wrap") as HTMLElement | null;
  const hidden = wrap ? wrap.hidden : lastPreviewContainer.hidden;
  if (!hidden) drawOverlay(lastPreviewData);
}

export function setMapClickHandler(handler: MapClickHandler | null): void {
  mapClickHandler = handler;
}

export function clearScrubMarker(): void {
  if (scrubMarker && map) {
    map.removeLayer(scrubMarker);
  }
  scrubMarker = null;
}

export function setScrubMarker(lat: number, lon: number): void {
  if (!map) return;
  if (!scrubMarker) {
    scrubMarker = L.circleMarker([lat, lon], {
      radius: 8,
      color: "#fff",
      fillColor: SCRUB_COLOR,
      fillOpacity: 1,
      weight: 2,
      pane: "markerPane",
    }).addTo(map);
  } else {
    scrubMarker.setLatLng([lat, lon]);
  }
}

function setPreviewVisible(container: HTMLElement, visible: boolean): void {
  const wrap = container.closest(".map-wrap") as HTMLElement | null;
  if (wrap) wrap.hidden = !visible;
  else container.hidden = !visible;
}

export function clearPreview(container: HTMLElement): void {
  setPreviewVisible(container, false);
  clearScrubMarker();
  overlay?.clearLayers();
  mapClickHandler = null;
  lastPreviewData = null;
  lastPreviewContainer = null;
}

export function showPreview(container: HTMLElement, data: GpxData): void {
  setPreviewVisible(container, true);
  const leafletMap = ensureMap(container);
  clearScrubMarker();
  lastPreviewData = data;
  lastPreviewContainer = container;

  const bounds = drawOverlay(data);

  const fit = () => {
    leafletMap.invalidateSize();
    if (bounds.isValid()) {
      leafletMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }
  };
  requestAnimationFrame(() => {
    fit();
    // Second pass after desktop grid / flex layout settles
    requestAnimationFrame(fit);
  });
}
