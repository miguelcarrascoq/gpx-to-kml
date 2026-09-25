/**
 * Interactive SVG elevation profile with scrubbing.
 */

import {
  formatDistance,
  formatElevation,
  type ProfileSample,
} from "./stats";

export type ScrubHandler = (sample: ProfileSample | null) => void;

const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

export class ElevationProfile {
  private readonly root: HTMLElement;
  private readonly chart: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly readouts: {
    distance: HTMLElement;
    elevation: HTMLElement;
    time: HTMLElement;
  };
  private samples: ProfileSample[] = [];
  private onScrub: ScrubHandler | null = null;
  private activeIndex = -1;
  private dragging = false;
  private svg: SVGSVGElement | null = null;
  private cursor: SVGLineElement | null = null;
  private dot: SVGCircleElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.chart = root.querySelector("[data-elevation-chart]") as HTMLElement;
    this.empty = root.querySelector("[data-elevation-empty]") as HTMLElement;
    this.readouts = {
      distance: root.querySelector("[data-readout-distance]") as HTMLElement,
      elevation: root.querySelector("[data-readout-elevation]") as HTMLElement,
      time: root.querySelector("[data-readout-time]") as HTMLElement,
    };
  }

  setOnScrub(handler: ScrubHandler | null): void {
    this.onScrub = handler;
  }

  clear(): void {
    this.samples = [];
    this.activeIndex = -1;
    this.dragging = false;
    this.chart.replaceChildren();
    this.svg = null;
    this.cursor = null;
    this.dot = null;
    this.root.hidden = true;
    this.empty.hidden = true;
    this.chart.hidden = true;
    this.setReadout(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  show(samples: ProfileSample[]): void {
    this.clear();
    this.root.hidden = false;

    if (samples.length < 2) {
      this.empty.hidden = false;
      this.chart.hidden = true;
      return;
    }

    this.samples = samples;
    this.empty.hidden = true;
    this.chart.hidden = false;
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.chart);
  }

  /** Highlight a sample by series index (from map click, etc.). */
  setActiveIndex(index: number): void {
    if (!this.samples.length) return;
    const clamped = Math.max(0, Math.min(this.samples.length - 1, index));
    this.applyActive(clamped, false);
  }

  setActiveSample(sample: ProfileSample | null): void {
    if (!sample) {
      this.applyActive(-1, false);
      return;
    }
    this.setActiveIndex(sample.index);
  }

  private render(): void {
    if (!this.samples.length) return;

    const width = Math.max(this.chart.clientWidth || 320, 200);
    const height = Math.max(this.chart.clientHeight || 140, 120);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    const distMax = this.samples[this.samples.length - 1].distanceM || 1;
    const elevs = this.samples.map((s) => s.ele);
    let elevMin = Math.min(...elevs);
    let elevMax = Math.max(...elevs);
    if (elevMax === elevMin) {
      elevMin -= 10;
      elevMax += 10;
    }
    const elevPad = (elevMax - elevMin) * 0.08;
    elevMin -= elevPad;
    elevMax += elevPad;

    const xAt = (d: number) => PAD.left + (d / distMax) * plotW;
    const yAt = (e: number) =>
      PAD.top + plotH - ((e - elevMin) / (elevMax - elevMin)) * plotH;

    const areaPts = this.samples
      .map((s) => `${xAt(s.distanceM).toFixed(1)},${yAt(s.ele).toFixed(1)}`)
      .join(" ");
    const baseY = (PAD.top + plotH).toFixed(1);
    const firstX = xAt(this.samples[0].distanceM).toFixed(1);
    const lastX = xAt(distMax).toFixed(1);
    const areaPath = `M ${firstX} ${baseY} L ${areaPts} L ${lastX} ${baseY} Z`;
    const linePath = `M ${areaPts.replace(/ /g, " L ")}`;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Elevation profile");
    svg.classList.add("elevation-svg");

    const defs = document.createElementNS(svgNS, "defs");
    const grad = document.createElementNS(svgNS, "linearGradient");
    grad.setAttribute("id", "elevFill");
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "1");
    const stop0 = document.createElementNS(svgNS, "stop");
    stop0.setAttribute("offset", "0%");
    stop0.setAttribute("stop-color", "#0d6e56");
    stop0.setAttribute("stop-opacity", "0.35");
    const stop1 = document.createElementNS(svgNS, "stop");
    stop1.setAttribute("offset", "100%");
    stop1.setAttribute("stop-color", "#0d6e56");
    stop1.setAttribute("stop-opacity", "0.02");
    grad.append(stop0, stop1);
    defs.append(grad);
    svg.append(defs);

    // Y-axis ticks (2–3)
    const tickCount = 3;
    for (let i = 0; i < tickCount; i++) {
      const t = i / (tickCount - 1);
      const ele = elevMin + (elevMax - elevMin) * (1 - t);
      const y = PAD.top + plotH * t;
      const grid = document.createElementNS(svgNS, "line");
      grid.setAttribute("x1", String(PAD.left));
      grid.setAttribute("x2", String(PAD.left + plotW));
      grid.setAttribute("y1", y.toFixed(1));
      grid.setAttribute("y2", y.toFixed(1));
      grid.setAttribute("class", "elevation-grid");
      svg.append(grid);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", String(PAD.left - 8));
      label.setAttribute("y", (y + 4).toFixed(1));
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "elevation-axis");
      label.textContent = `${Math.round(ele)}`;
      svg.append(label);
    }

    // X labels
    const xLabel0 = document.createElementNS(svgNS, "text");
    xLabel0.setAttribute("x", String(PAD.left));
    xLabel0.setAttribute("y", String(height - 8));
    xLabel0.setAttribute("class", "elevation-axis");
    xLabel0.textContent = "0";
    svg.append(xLabel0);

    const xLabel1 = document.createElementNS(svgNS, "text");
    xLabel1.setAttribute("x", String(PAD.left + plotW));
    xLabel1.setAttribute("y", String(height - 8));
    xLabel1.setAttribute("text-anchor", "end");
    xLabel1.setAttribute("class", "elevation-axis");
    xLabel1.textContent = formatDistance(distMax);
    svg.append(xLabel1);

    const area = document.createElementNS(svgNS, "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("fill", "url(#elevFill)");
    area.setAttribute("class", "elevation-area");
    svg.append(area);

    const line = document.createElementNS(svgNS, "path");
    line.setAttribute("d", linePath);
    line.setAttribute("fill", "none");
    line.setAttribute("class", "elevation-line");
    svg.append(line);

    const cursor = document.createElementNS(svgNS, "line");
    cursor.setAttribute("y1", String(PAD.top));
    cursor.setAttribute("y2", String(PAD.top + plotH));
    cursor.setAttribute("class", "elevation-cursor");
    cursor.setAttribute("visibility", "hidden");
    svg.append(cursor);

    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("r", "5");
    dot.setAttribute("class", "elevation-dot");
    dot.setAttribute("visibility", "hidden");
    svg.append(dot);

    const hit = document.createElementNS(svgNS, "rect");
    hit.setAttribute("x", String(PAD.left));
    hit.setAttribute("y", String(PAD.top));
    hit.setAttribute("width", String(plotW));
    hit.setAttribute("height", String(plotH));
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("class", "elevation-hit");
    hit.style.cursor = "crosshair";
    svg.append(hit);

    this.chart.replaceChildren(svg);
    this.svg = svg;
    this.cursor = cursor;
    this.dot = dot;

    const pick = (clientX: number) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const x = (clientX - rect.left) * scaleX;
      const ratio = Math.max(0, Math.min(1, (x - PAD.left) / plotW));
      const targetDist = ratio * distMax;
      let best = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < this.samples.length; i++) {
        const d = Math.abs(this.samples[i].distanceM - targetDist);
        if (d < bestDelta) {
          bestDelta = d;
          best = i;
        }
      }
      this.applyActive(best, true);
    };

    hit.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      hit.setPointerCapture(e.pointerId);
      pick(e.clientX);
    });
    hit.addEventListener("pointermove", (e) => {
      if (!this.dragging && e.buttons === 0) {
        pick(e.clientX);
        return;
      }
      if (this.dragging) pick(e.clientX);
    });
    hit.addEventListener("pointerup", (e) => {
      this.dragging = false;
      try {
        hit.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    });
    hit.addEventListener("pointerleave", () => {
      if (!this.dragging) {
        /* keep last position visible */
      }
    });

    // Restore active cursor after re-render
    if (this.activeIndex >= 0) {
      this.applyActive(this.activeIndex, false);
    }
  }

  private applyActive(index: number, emit: boolean): void {
    this.activeIndex = index;
    const sample = index >= 0 ? this.samples[index] : null;
    this.setReadout(sample);

    if (!this.svg || !this.cursor || !this.dot || !sample) {
      this.cursor?.setAttribute("visibility", "hidden");
      this.dot?.setAttribute("visibility", "hidden");
      if (emit) this.onScrub?.(null);
      return;
    }

    const width = this.svg.viewBox.baseVal.width;
    const height = this.svg.viewBox.baseVal.height;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const distMax = this.samples[this.samples.length - 1].distanceM || 1;
    const elevs = this.samples.map((s) => s.ele);
    let elevMin = Math.min(...elevs);
    let elevMax = Math.max(...elevs);
    if (elevMax === elevMin) {
      elevMin -= 10;
      elevMax += 10;
    }
    const elevPad = (elevMax - elevMin) * 0.08;
    elevMin -= elevPad;
    elevMax += elevPad;

    const x =
      PAD.left + (sample.distanceM / distMax) * plotW;
    const y =
      PAD.top +
      plotH -
      ((sample.ele - elevMin) / (elevMax - elevMin)) * plotH;

    this.cursor.setAttribute("x1", x.toFixed(1));
    this.cursor.setAttribute("x2", x.toFixed(1));
    this.cursor.setAttribute("visibility", "visible");
    this.dot.setAttribute("cx", x.toFixed(1));
    this.dot.setAttribute("cy", y.toFixed(1));
    this.dot.setAttribute("visibility", "visible");

    if (emit) this.onScrub?.(sample);
  }

  private setReadout(sample: ProfileSample | null): void {
    if (!sample) {
      this.readouts.distance.textContent = "—";
      this.readouts.elevation.textContent = "—";
      this.readouts.time.textContent = "—";
      return;
    }
    this.readouts.distance.textContent = formatDistance(sample.distanceM);
    this.readouts.elevation.textContent = formatElevation(sample.ele);
    if (sample.point.time) {
      const d = new Date(sample.point.time);
      this.readouts.time.textContent = Number.isNaN(d.getTime())
        ? "—"
        : d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
    } else {
      this.readouts.time.textContent = "—";
    }
  }
}
