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

const TRACK_COLOR = "#0d6e56";
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

export function clearPreview(container: HTMLElement): void {
  container.hidden = true;
  clearScrubMarker();
  overlay?.clearLayers();
  mapClickHandler = null;
}

export function showPreview(container: HTMLElement, data: GpxData): void {
  container.hidden = false;
  const leafletMap = ensureMap(container);
  clearScrubMarker();
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
