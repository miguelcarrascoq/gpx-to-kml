/**
 * GPX → KML conversion (browser + Node with a DOMParser implementation).
 */

function localName(el) {
  return (el.localName || el.nodeName || "").replace(/^.*:/, "").toLowerCase();
}

function childElements(parent) {
  return Array.from(parent.childNodes || []).filter((n) => n.nodeType === 1);
}

function findChildren(parent, name) {
  const target = name.toLowerCase();
  return childElements(parent).filter((el) => localName(el) === target);
}

function findDescendants(root, name) {
  const target = name.toLowerCase();
  const results = [];
  const walk = (node) => {
    for (const el of childElements(node)) {
      if (localName(el) === target) results.push(el);
      walk(el);
    }
  };
  walk(root);
  return results;
}

function textContent(el) {
  return (el && el.textContent ? el.textContent : "").trim();
}

function firstChildText(parent, name) {
  const kids = findChildren(parent, name);
  return kids.length ? textContent(kids[0]) : "";
}

function attr(el, name) {
  if (!el || !el.getAttribute) return "";
  const v = el.getAttribute(name);
  return v == null ? "" : String(v).trim();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parsePoint(el) {
  const lat = parseFloat(attr(el, "lat"));
  const lon = parseFloat(attr(el, "lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const eleRaw = firstChildText(el, "ele");
  const ele = eleRaw === "" ? null : parseFloat(eleRaw);
  const time = firstChildText(el, "time") || null;
  const name = firstChildText(el, "name") || null;
  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null,
    time,
    name,
  };
}

function coordTuple(p) {
  if (p.ele != null) return `${p.lon},${p.lat},${p.ele}`;
  return `${p.lon},${p.lat}`;
}

/**
 * @param {string} xmlText
 * @param {typeof DOMParser} [DOMParserImpl]
 * @returns {{ name: string, tracks: object[], routes: object[], waypoints: object[], pointCount: number }}
 */
export function parseGpx(xmlText, DOMParserImpl = globalThis.DOMParser) {
  if (!DOMParserImpl) {
    throw new Error("DOMParser is not available");
  }
  const doc = new DOMParserImpl().parseFromString(xmlText, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("Invalid GPX/XML: " + textContent(parseError).slice(0, 200));
  }

  const root =
    findDescendants(doc, "gpx")[0] ||
    (doc.documentElement && localName(doc.documentElement) === "gpx"
      ? doc.documentElement
      : null);
  if (!root) {
    throw new Error("Not a GPX file (missing <gpx> root)");
  }

  const metaName =
    firstChildText(findChildren(root, "metadata")[0] || root, "name") || "";

  const tracks = [];
  for (const trk of findChildren(root, "trk")) {
    const name = firstChildText(trk, "name") || "Track";
    const segments = [];
    for (const seg of findChildren(trk, "trkseg")) {
      const points = [];
      for (const pt of findChildren(seg, "trkpt")) {
        const p = parsePoint(pt);
        if (p) points.push(p);
      }
      if (points.length) segments.push(points);
    }
    // Fall back: trkpt directly under trk
    if (!segments.length) {
      const points = [];
      for (const pt of findChildren(trk, "trkpt")) {
        const p = parsePoint(pt);
        if (p) points.push(p);
      }
      if (points.length) segments.push(points);
    }
    if (segments.length) tracks.push({ name, segments });
  }

  const routes = [];
  for (const rte of findChildren(root, "rte")) {
    const name = firstChildText(rte, "name") || "Route";
    const points = [];
    for (const pt of findChildren(rte, "rtept")) {
      const p = parsePoint(pt);
      if (p) points.push(p);
    }
    if (points.length) routes.push({ name, points });
  }

  const waypoints = [];
  for (const wpt of findChildren(root, "wpt")) {
    const p = parsePoint(wpt);
    if (p) waypoints.push(p);
  }

  const pointCount =
    tracks.reduce(
      (n, t) => n + t.segments.reduce((m, s) => m + s.length, 0),
      0
    ) +
    routes.reduce((n, r) => n + r.points.length, 0) +
    waypoints.length;

  return {
    name: metaName || tracks[0]?.name || routes[0]?.name || "GPX Convert",
    tracks,
    routes,
    waypoints,
    pointCount,
  };
}

/**
 * @param {ReturnType<typeof parseGpx>} data
 * @returns {string}
 */
export function buildKml(data) {
  const placemarks = [];

  for (const trk of data.tracks) {
    trk.segments.forEach((seg, idx) => {
      const label =
        trk.segments.length > 1 ? `${trk.name} (segment ${idx + 1})` : trk.name;
      const coords = seg.map(coordTuple).join(" ");
      placemarks.push(`    <Placemark>
      <name>${escapeXml(label)}</name>
      <Style>
        <LineStyle>
          <color>ff2a6aef</color>
          <width>3</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`);
    });
  }

  for (const rte of data.routes) {
    const coords = rte.points.map(coordTuple).join(" ");
    placemarks.push(`    <Placemark>
      <name>${escapeXml(rte.name)}</name>
      <Style>
        <LineStyle>
          <color>ff1a9b6c</color>
          <width>3</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`);
  }

  for (const wpt of data.waypoints) {
    const name = wpt.name || "Waypoint";
    placemarks.push(`    <Placemark>
      <name>${escapeXml(name)}</name>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coordTuple(wpt)}</coordinates>
      </Point>
    </Placemark>`);
  }

  if (!placemarks.length) {
    throw new Error("No tracks, routes, or waypoints found in GPX");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(data.name)}</name>
${placemarks.join("\n")}
  </Document>
</kml>
`;
}

/**
 * @param {string} xmlText
 * @param {typeof DOMParser} [DOMParserImpl]
 * @returns {{ kml: string, data: ReturnType<typeof parseGpx> }}
 */
export function gpxToKml(xmlText, DOMParserImpl = globalThis.DOMParser) {
  const data = parseGpx(xmlText, DOMParserImpl);
  const kml = buildKml(data);
  return { kml, data };
}
