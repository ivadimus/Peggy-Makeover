(function (global) {
  "use strict";

  const EPS = 1e-9;
  /** Pixels each cell grows by so adjacent pieces overlap instead of leaving a seam. */
  const SEAM_OVERLAP = 2.5;

  function distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function rectPolygon(width, height, marginX = 0) {
    const x0 = marginX;
    const x1 = width - marginX;
    return [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: height },
      { x: x0, y: height },
    ];
  }

  /** Keep points closer to siteA than to siteB. */
  function clipHalfPlane(polygon, siteA, siteB) {
    if (polygon.length === 0) return [];

    const origin = { x: 0, y: 0 };
    const d = { x: siteB.x - siteA.x, y: siteB.y - siteA.y };
    const c = distSq(siteB, origin) - distSq(siteA, origin);

    function inside(p) {
      return 2 * dot(d, p) <= c + EPS;
    }

    function intersect(p1, p2) {
      const dp = { x: p2.x - p1.x, y: p2.y - p1.y };
      const denom = 2 * dot(d, dp);
      if (Math.abs(denom) < EPS) return { x: p1.x, y: p1.y };
      const t = (c - 2 * dot(d, p1)) / denom;
      return {
        x: p1.x + t * dp.x,
        y: p1.y + t * dp.y,
      };
    }

    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const previous = polygon[(i + polygon.length - 1) % polygon.length];
      const currIn = inside(current);
      const prevIn = inside(previous);

      if (currIn) {
        if (!prevIn) {
          output.push(intersect(previous, current));
        }
        output.push(current);
      } else if (prevIn) {
        output.push(intersect(previous, current));
      }
    }
    return output;
  }

  function voronoiCell(site, allSites, width, height, marginX = 0) {
    let poly = rectPolygon(width, height, marginX);
    for (let i = 0; i < allSites.length; i++) {
      if (i === site.index) continue;
      poly = clipHalfPlane(poly, site, allSites[i]);
      if (poly.length === 0) break;
    }
    return poly;
  }

  function polygonCentroid(polygon) {
    if (polygon.length === 0) return { x: 0, y: 0 };
    if (polygon.length < 3) {
      let sx = 0;
      let sy = 0;
      for (const p of polygon) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / polygon.length, y: sy / polygon.length };
    }

    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p0 = polygon[i];
      const p1 = polygon[(i + 1) % polygon.length];
      const cross = p0.x * p1.y - p1.x * p0.y;
      area += cross;
      cx += (p0.x + p1.x) * cross;
      cy += (p0.y + p1.y) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < EPS) {
      let sx = 0;
      let sy = 0;
      for (const p of polygon) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / polygon.length, y: sy / polygon.length };
    }
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  function polygonToPoints(polygon) {
    return polygon.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  }

  function signedArea(polygon) {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p0 = polygon[i];
      const p1 = polygon[(i + 1) % polygon.length];
      sum += p0.x * p1.y - p1.x * p0.y;
    }
    return sum * 0.5;
  }

  function polygonArea(polygon) {
    if (polygon.length < 3) return 0;
    return Math.abs(signedArea(polygon));
  }

  /**
   * Push every edge outward by `pad` so neighbouring cells overlap slightly,
   * which hides the antialiased hairline seam between them.
   */
  function expandPolygon(polygon, pad) {
    if (polygon.length < 3 || pad <= 0) return polygon;

    const poly = signedArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
    const n = poly.length;
    const edges = [];

    for (let i = 0; i < n; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % n];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < EPS) continue;

      const ux = dx / len;
      const uy = dy / len;
      // Outward normal for a positively-signed (counter-clockwise) polygon.
      edges.push({
        point: { x: p0.x + uy * pad, y: p0.y - ux * pad },
        dir: { x: ux, y: uy },
      });
    }

    if (edges.length < 3) return polygon;

    const result = [];
    for (let i = 0; i < edges.length; i++) {
      const a = edges[i];
      const b = edges[(i + 1) % edges.length];
      const cross = a.dir.x * b.dir.y - a.dir.y * b.dir.x;

      if (Math.abs(cross) < EPS) {
        result.push({ x: b.point.x, y: b.point.y });
        continue;
      }

      const wx = b.point.x - a.point.x;
      const wy = b.point.y - a.point.y;
      const t = (wx * b.dir.y - wy * b.dir.x) / cross;
      result.push({ x: a.point.x + a.dir.x * t, y: a.point.y + a.dir.y * t });
    }

    return result;
  }

  function cloneSite(site) {
    return { x: site.x, y: site.y, index: site.index };
  }

  function cellsForSites(sites, width, height) {
    return sites.map((site) => {
      const polygon = voronoiCell(site, sites, width, height);
      return {
        index: site.index,
        site,
        polygon,
        area: polygonArea(polygon),
        centroid: polygonCentroid(polygon),
      };
    });
  }

  function areaBalanceRatio(cells) {
    const areas = cells.map((c) => c.area).filter((a) => a > EPS);
    if (areas.length === 0) return Infinity;
    const min = Math.min(...areas);
    const max = Math.max(...areas);
    if (min < EPS) return Infinity;
    return max / min;
  }

  /**
   * How many seeds sit on each row. Rows are chosen so cells come out roughly
   * square, and the remainder is spread one per row so no slot is left empty.
   */
  function rowCounts(count, width, height) {
    let rows = Math.max(1, Math.round(Math.sqrt((count * height) / width)));
    rows = Math.min(rows, count);

    const base = Math.floor(count / rows);
    const extra = count % rows;
    const counts = [];
    for (let row = 0; row < rows; row++) {
      counts.push(base + (row < extra ? 1 : 0));
    }
    return counts;
  }

  /**
   * Split `total` into `n` uneven parts. `spread` is how far each part may drift
   * from an equal share, so slots — and therefore cells — differ in size.
   */
  function randomSpans(total, n, spread) {
    const weights = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = 1 + (Math.random() * 2 - 1) * spread;
      weights.push(w);
      sum += w;
    }
    return weights.map((w) => (w / sum) * total);
  }

  /** Rows of unequal slots, with each seed nudged around inside its own slot. */
  function jitteredGridSeeds(count, width, height, jitter, spread) {
    const counts = rowCounts(count, width, height);
    const rowHeights = randomSpans(height, counts.length, spread);
    const seeds = [];
    let rowTop = 0;

    counts.forEach((cols, row) => {
      const rowHeight = rowHeights[row];
      const colWidths = randomSpans(width, cols, spread);
      let colLeft = 0;

      for (let col = 0; col < cols; col++) {
        const colWidth = colWidths[col];
        const x = colLeft + colWidth * (0.5 + (Math.random() - 0.5) * jitter);
        const y = rowTop + rowHeight * (0.5 + (Math.random() - 0.5) * jitter);
        seeds.push({
          x: Math.max(1, Math.min(width - 1, x)),
          y: Math.max(1, Math.min(height - 1, y)),
          index: seeds.length,
        });
        colLeft += colWidth;
      }
      rowTop += rowHeight;
    });

    return seeds;
  }

  /**
   * Partial Lloyd steps. Moving only part of the way to the centroid rounds off
   * slivers without collapsing the layout back to an even, obviously regular grid.
   */
  function smoothSites(sites, width, height, passes, strength) {
    let current = sites.map(cloneSite);

    for (let pass = 0; pass < passes; pass++) {
      const cells = cellsForSites(current, width, height);
      current = cells.map((cell, i) => ({
        x: current[i].x + (cell.centroid.x - current[i].x) * strength,
        y: current[i].y + (cell.centroid.y - current[i].y) * strength,
        index: cell.index,
      }));
    }

    return current;
  }

  function generateBalancedSites(count, width, height) {
    const JITTER = 0.55;
    const SPREAD = 0.42;
    // Largest piece may be ~2-3.4x the smallest: clearly varied, no slivers.
    const TARGET_MIN = 1.9;
    const TARGET_MAX = 3.4;
    const MAX_ATTEMPTS = 14;
    const midRatio = (TARGET_MIN + TARGET_MAX) / 2;

    let bestSites = null;
    let bestScore = Infinity;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const sites = smoothSites(
        jitteredGridSeeds(count, width, height, JITTER, SPREAD),
        width,
        height,
        1,
        0.22
      );
      const ratio = areaBalanceRatio(cellsForSites(sites, width, height));

      if (ratio >= TARGET_MIN && ratio <= TARGET_MAX) return sites;

      const score = Math.abs(ratio - midRatio);
      if (score < bestScore) {
        bestScore = score;
        bestSites = sites;
      }
    }

    return bestSites;
  }

  function sitesFromNormalized(normalizedSites, width, height) {
    return normalizedSites.map((s, index) => ({
      x: s.nx * width,
      y: s.ny * height,
      index,
    }));
  }

  /** New balanced layout once per page load (normalized 0–1 coordinates). */
  function createSiteLayout(count, width, height) {
    const sites = generateBalancedSites(count, width, height);
    return sites.map((s) => ({
      nx: s.x / width,
      ny: s.y / height,
    }));
  }

  function computeVoronoi(count, width, height, normalizedSites, marginX = 0) {
    const sites = normalizedSites
      ? sitesFromNormalized(normalizedSites, width, height)
      : generateBalancedSites(count, width, height);

    return sites.map((site) => {
      const polygon = voronoiCell(site, sites, width, height, marginX);
      // Slight overlap between neighbours so no background shows through the seams.
      const padded = expandPolygon(polygon, SEAM_OVERLAP);
      return {
        index: site.index,
        site,
        polygon: padded,
        centroid: polygonCentroid(polygon),
        pointsAttr: polygonToPoints(padded),
      };
    });
  }

  global.VoronoiReveal = {
    PIECE_COUNT: 6,
    createSiteLayout,
    computeVoronoi,
    expandPolygon,
    polygonToPoints,
    polygonArea,
  };
})(window);
