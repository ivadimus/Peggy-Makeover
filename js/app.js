(function () {
  "use strict";

  /** Wall-clock length of the clear / hose spray. */
  const WIPE_MS = 900;
  /** Prebaked wipe.mp4 luma-matte frames (organic brush, no hard edges). */
  const WIPE_FRAME_COUNT = 33;

  const FEATHER = 22;
  /** Blur radius of the soft fade where a piece meets its neighbour. */
  const EDGE_FADE = 8.5;
  /** Corner rounding and the room the edge warp needs outside the stage. */
  const CORNER_RADIUS = 56;
  /** How far edge midpoints bend so borders never read as straight lines. */
  const EDGE_WAVE = 18;
  /** Subdivision spacing along each edge before wave + smoothing. */
  const EDGE_STEP = 14;
  const EDGE_PAD = 180;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";

  const playArea = document.getElementById("play-area");
  const svgLayer = document.getElementById("voronoi-layer");
  const iconsLayer = document.getElementById("icons-layer");
  const vfxLayer = document.getElementById("vfx-layer");
  const celebrateLayer = document.getElementById("celebrate-layer");
  const rewardScreen = document.getElementById("reward-screen");
  const rewardCoinsEl = document.getElementById("reward-coins");
  const rewardGemsEl = document.getElementById("reward-gems");
  const stateBImg = document.getElementById("state-b");
  const controls = document.getElementById("controls");
  const hudTopCountEl = document.getElementById("hud-top-count");

  let currency = budgetForPieceCount(VoronoiReveal.PIECE_COUNT);
  let displayCurrency = currency;
  let currencyAnimRaf = 0;

  function budgetForPieceCount(count) {
    if (count <= 6) return 100;
    if (count <= 12) return 500;
    return 1000; // 16–18 pieces
  }

  /** Prototype scenes — swap dirty/clean art as more rooms are added. */
  const SCENES = [
    {
      dirty: "assets/state1.jpg?v=5",
      clean: "assets/state2.jpg?v=5",
      coins: 3520,
      gems: 352,
    },
    {
      dirty: "assets/state1.jpg?v=5",
      clean: "assets/state2.jpg?v=5",
      coins: 4100,
      gems: 410,
    },
  ];

  const CELEBRATE_MS = 2400;
  /**
   * Truck silhouette (normalized). Hood is lower than the cab roof; trailer
   * bed is lower still. Chassis bottom keeps markers off the ground under the
   * frame; the front-wheel band dips to the tire contact patch.
   */
  /**
   * Measured directly from the silhouette image (state2.png / the mask) the
   * user supplied: 48 even x-slices between TRUCK_LEFT_FRAC and
   * TRUCK_RIGHT_FRAC, each the median top/bottom row (as a fraction of image
   * height) of the black silhouette pixels in that slice. Median rather than
   * min/max so a single-column outlier (the thin antenna, a 1-pixel gap
   * between wheels) can't distort a whole slice. See truckVerticalRange().
   */
  const TRUCK_LEFT_FRAC = 0.1134;
  const TRUCK_RIGHT_FRAC = 0.9259;
  const TRUCK_TOP_TABLE = [
    0.5898, 0.5703, 0.5625, 0.5586, 0.5208, 0.5, 0.4909, 0.4831, 0.4792,
    0.4362, 0.3828, 0.3789, 0.3555, 0.3451, 0.3385, 0.3346, 0.332, 0.3307,
    0.3307, 0.332, 0.3333, 0.3372, 0.3411, 0.2982, 0.3008, 0.4779, 0.4779,
    0.4779, 0.4792, 0.4792, 0.4792, 0.4792, 0.4792, 0.4714, 0.4421, 0.4453,
    0.4297, 0.4076, 0.4154, 0.4049, 0.3958, 0.4186, 0.4297, 0.4349, 0.4479,
    0.4674, 0.4844, 0.4987,
  ];
  const TRUCK_BOT_TABLE = [
    0.7826, 0.8294, 0.8646, 0.8802, 0.8893, 0.8919, 0.888, 0.8776, 0.8503,
    0.8307, 0.832, 0.8268, 0.8958, 0.9238, 0.9349, 0.9414, 0.9453, 0.9466,
    0.9375, 0.9154, 0.8809, 0.8138, 0.806, 0.7793, 0.7695, 0.7682, 0.763,
    0.8197, 0.8398, 0.8477, 0.8503, 0.8503, 0.8398, 0.8099, 0.7168, 0.7344,
    0.7448, 0.7461, 0.7409, 0.7083, 0.6953, 0.6966, 0.7513, 0.7656, 0.7695,
    0.7695, 0.7565, 0.6549,
  ];
  // Representative single-number stand-ins for code paths below that need a
  // rough envelope rather than the exact per-x profile (sampling ranges,
  // the decorative truck glow). Taken from the table above.
  const TRUCK_TOP_CAB = 0.33; // cab roof, the table's highest point (excl. antenna)
  const TRUCK_CAB_END_X = 0.5; // roughly where the cab ends and the trailer begins
  const TRUCK_CHASSIS_BOTTOM = 0.7; // body bottom between wheel wells
  const TRUCK_WHEEL_BOTTOM = 0.95; // deepest wheel contact point in the table
  const FRONT_WHEEL_X0 = 0.2;
  const FRONT_WHEEL_X1 = 0.5;
  const TRAILER_WHEEL_X0 = 0.58;
  const TRAILER_WHEEL_X1 = 0.82;
  const EDGE_PAD_LEFT_PX = 210;
  const EDGE_PAD_RIGHT_PX = 100;
  const EDGE_PAD_BOTTOM_PX = 100;
  const EDGE_PAD_PX = 100; // voronoi side inset

  let sceneIndex = 0;
  let stateAUrl = SCENES[0].dirty;
  const iconUrl = "assets/SKU.png";

  let pieceCount = VoronoiReveal.PIECE_COUNT;
  let clearedCount = 0;
  let layoutWidth = 0;
  let layoutHeight = 0;
  let siteLayout = null;
  let celebrating = false;
  let rewardOpen = false;
  const cellPolygons = new Map();

  /** Full-stage dust + spider-web overlay; punched out as pieces clear. */
  let dustCanvas = null;
  let dustCtx = null;
  let dustBase = null;
  /** Soft masks of already-cleaned cells, for redrawing the dust holes. */
  const clearedDustMasks = [];

  const stateAImage = new Image();
  stateAImage.decoding = "async";
  stateAImage.src = stateAUrl;

  function applySceneArt(scene) {
    stateAUrl = scene.dirty + "?v=2";
    stateAImage.src = stateAUrl;
    if (stateBImg) stateBImg.src = scene.clean + "?v=2";
  }

  applySceneArt(SCENES[sceneIndex]);

  /** Reference splash sequence (watermarked_preview.mp4, one cycle). */
  const SPLASH_FRAME_COUNT = 35;
  const SPLASH_MS = 1167;
  /** @type {HTMLImageElement[]} */
  const splashFrames = [];
  for (let i = 0; i < SPLASH_FRAME_COUNT; i++) {
    const img = new Image();
    img.decoding = "async";
    img.src = `assets/splash-frames/splash_${String(i).padStart(2, "0")}.png`;
    splashFrames.push(img);
  }

  /** Play the reference splash animation centered on a point. */
  function playSplashFx(cx, cy, diameter) {
    const size = Math.max(140, Math.min(340, diameter));
    const el = document.createElement("img");
    el.className = "wipe-splash";
    el.alt = "";
    el.draggable = false;
    el.src = splashFrames[0]?.src || "";
    el.style.cssText = [
      "position:absolute",
      `left:${cx - size / 2}px`,
      `top:${cy - size / 2}px`,
      `width:${size}px`,
      `height:${size}px`,
      "object-fit:contain",
      "pointer-events:none",
      "z-index:55",
      "opacity:1",
    ].join(";");
    playArea.appendChild(el);

    const born = performance.now();
    let rafId = 0;
    function frame(now) {
      const t = Math.min(1, (now - born) / SPLASH_MS);
      const idx = Math.min(
        SPLASH_FRAME_COUNT - 1,
        Math.floor(t * SPLASH_FRAME_COUNT)
      );
      const src = splashFrames[idx];
      if (src && src.complete && src.naturalWidth) el.src = src.src;
      el.style.opacity = t > 0.85 ? String(Math.max(0, (1 - t) / 0.15)) : "1";
      if (t < 1) rafId = requestAnimationFrame(frame);
      else el.remove();
    }
    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      el.remove();
    };
  }

  /** @type {HTMLImageElement[]} */
  const wipeFrames = [];
  let wipeReady = false;

  function loadWipeFrames() {
    const loaders = [];
    for (let i = 0; i < WIPE_FRAME_COUNT; i++) {
      const id = String(i).padStart(2, "0");
      const matte = new Image();
      matte.decoding = "async";
      wipeFrames.push(matte);
      loaders.push(
        new Promise((resolve) => {
          matte.onload = resolve;
          matte.onerror = resolve;
          matte.src = `assets/wipe-frames/matte-${id}.png?v=1`;
        })
      );
    }
    return Promise.all(loaders).then(() => {
      wipeReady = wipeFrames.every((f) => f.complete && f.naturalWidth > 0);
    });
  }

  loadWipeFrames();

  function getStageSize() {
    const rect = playArea.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  const ICON_SIZE_PX = 84;
  const ICON_GAP_PX = 10;
  /** Matches .cell-icon size + negative margin (anchor = center of plate). */
  const ICON_HALF_W_PX = 42;
  const ICON_EXTENT_TOP_PX = 54;
  const ICON_EXTENT_BOTTOM_PX = 44;

  /**
   * Vertical range on the truck at normalized X — hood / cab / trailer top,
   * chassis or wheel bottom.
   */
  function truckVerticalRange(nx) {
    const table = TRUCK_TOP_TABLE;
    const n = table.length;
    const span = TRUCK_RIGHT_FRAC - TRUCK_LEFT_FRAC;
    const t =
      Math.min(1, Math.max(0, (nx - TRUCK_LEFT_FRAC) / span)) * (n - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = t - i0;
    const top =
      TRUCK_TOP_TABLE[i0] + (TRUCK_TOP_TABLE[i1] - TRUCK_TOP_TABLE[i0]) * f;
    const bot =
      TRUCK_BOT_TABLE[i0] + (TRUCK_BOT_TABLE[i1] - TRUCK_BOT_TABLE[i0]) * f;
    return { top, bot };
  }

  /** Horizontal clamp for icon centers (screen + truck sides). */
  function iconXBounds(width) {
    const minX = Math.max(
      EDGE_PAD_LEFT_PX + ICON_HALF_W_PX,
      width * TRUCK_LEFT_FRAC + ICON_HALF_W_PX
    );
    const maxX = Math.min(
      width - EDGE_PAD_RIGHT_PX - ICON_HALF_W_PX,
      width * TRUCK_RIGHT_FRAC - ICON_HALF_W_PX
    );
    return { minX, maxX: Math.max(minX, maxX) };
  }

  /** Vertical clamp for an icon center at pixel X. */
  function iconYBoundsAtX(x, width, height) {
    const nx = x / width;
    const { top, bot } = truckVerticalRange(nx);
    const minY = height * top + ICON_EXTENT_TOP_PX;
    // Front wheel may sit closer to the stage bottom than EDGE_PAD_BOTTOM.
    const onFrontWheel = nx >= FRONT_WHEEL_X0 && nx <= FRONT_WHEEL_X1;
    const bottomPad = onFrontWheel
      ? Math.min(EDGE_PAD_BOTTOM_PX, 36)
      : EDGE_PAD_BOTTOM_PX;
    const maxY = Math.min(
      height * bot - ICON_EXTENT_BOTTOM_PX,
      height - bottomPad - ICON_EXTENT_BOTTOM_PX
    );
    return { minY, maxY: Math.max(minY, maxY) };
  }

  /** Numbers must never sit inside this bottom-right corner box. */
  const NUMBER_NO_ZONE_RIGHT_PX = 100;
  const NUMBER_NO_ZONE_BOTTOM_PX = 50;

  /** Push a point out of the bottom-right no-number corner if it landed inside it. */
  function pushOutOfNumberNoZone(x, y, width, height) {
    const zoneLeft = width - NUMBER_NO_ZONE_RIGHT_PX;
    const zoneTop = height - NUMBER_NO_ZONE_BOTTOM_PX;
    if (x <= zoneLeft || y <= zoneTop) return { x, y };
    // Move out whichever way is the shorter push.
    const pushLeft = x - zoneLeft;
    const pushUp = y - zoneTop;
    return pushLeft <= pushUp ? { x: zoneLeft, y } : { x, y: zoneTop };
  }

  function clampIconPoint(x, y, width, height) {
    const xb = iconXBounds(width);
    const cx = Math.min(xb.maxX, Math.max(xb.minX, x));
    const yb = iconYBoundsAtX(cx, width, height);
    const cy = Math.min(yb.maxY, Math.max(yb.minY, y));
    return pushOutOfNumberNoZone(cx, cy, width, height);
  }

  function isValidIconSite(nx, ny, width, height) {
    const xb = iconXBounds(width);
    const xPx = nx * width;
    if (xPx < xb.minX || xPx > xb.maxX) return false;
    const yb = iconYBoundsAtX(xPx, width, height);
    const yPx = ny * height;
    if (yPx < yb.minY || yPx > yb.maxY) return false;
    if (
      xPx > width - NUMBER_NO_ZONE_RIGHT_PX &&
      yPx > height - NUMBER_NO_ZONE_BOTTOM_PX
    ) {
      return false;
    }
    return true;
  }

  function isOnWheel(nx, ny) {
    const inFront = nx >= FRONT_WHEEL_X0 && nx <= FRONT_WHEEL_X1;
    const inTrailer = nx >= TRAILER_WHEEL_X0 && nx <= TRAILER_WHEEL_X1;
    if (!inFront && !inTrailer) return false;
    return ny >= TRUCK_CHASSIS_BOTTOM - 0.01 && ny <= TRUCK_WHEEL_BOTTOM;
  }

  /** Sample a site on a specific wheel slot: 0=front, 1–2=trailer. */
  function sampleWheelSite(slot, width, height, existing, minDistPx2) {
    let x0;
    let x1;
    if (slot === 0) {
      x0 = FRONT_WHEEL_X0;
      x1 = FRONT_WHEEL_X1;
    } else if (slot === 1) {
      const span = TRAILER_WHEEL_X1 - TRAILER_WHEEL_X0;
      x0 = TRAILER_WHEEL_X0;
      x1 = TRAILER_WHEEL_X0 + span * 0.48;
    } else {
      const span = TRAILER_WHEEL_X1 - TRAILER_WHEEL_X0;
      x0 = TRAILER_WHEEL_X0 + span * 0.52;
      x1 = TRAILER_WHEEL_X1;
    }
    const y0 = TRUCK_CHASSIS_BOTTOM + 0.015;
    const y1 = TRUCK_WHEEL_BOTTOM - 0.02;

    function pixelDist2(a, b) {
      const dx = (a.nx - b.nx) * width;
      const dy = (a.ny - b.ny) * height;
      return dx * dx + dy * dy;
    }

    for (let attempt = 0; attempt < 80; attempt++) {
      const p = {
        nx: x0 + Math.random() * Math.max(0.01, x1 - x0),
        ny: y0 + Math.random() * Math.max(0.01, y1 - y0),
      };
      const c = clampIconPoint(p.nx * width, p.ny * height, width, height);
      const q = { nx: c.x / width, ny: c.y / height };
      if (!isOnWheel(q.nx, q.ny)) continue;
      if (!isValidIconSite(q.nx, q.ny, width, height)) continue;
      let ok = true;
      for (const s of existing) {
        if (pixelDist2(q, s) < minDistPx2) {
          ok = false;
          break;
        }
      }
      if (ok) return q;
    }
    // Fallback: center of the wheel slot.
    const c = clampIconPoint(
      ((x0 + x1) * 0.5) * width,
      ((y0 + y1) * 0.55) * height,
      width,
      height
    );
    return { nx: c.x / width, ny: c.y / height };
  }

  function snapToWheelSlot(site, slot, width, height) {
    let x0;
    let x1;
    if (slot === 0) {
      x0 = FRONT_WHEEL_X0;
      x1 = FRONT_WHEEL_X1;
    } else if (slot === 1) {
      const span = TRAILER_WHEEL_X1 - TRAILER_WHEEL_X0;
      x0 = TRAILER_WHEEL_X0;
      x1 = TRAILER_WHEEL_X0 + span * 0.48;
    } else {
      const span = TRAILER_WHEEL_X1 - TRAILER_WHEEL_X0;
      x0 = TRAILER_WHEEL_X0 + span * 0.52;
      x1 = TRAILER_WHEEL_X1;
    }
    const y0 = TRUCK_CHASSIS_BOTTOM + 0.015;
    const y1 = TRUCK_WHEEL_BOTTOM - 0.02;
    const nx = Math.min(x1, Math.max(x0, site.nx));
    const ny = Math.min(y1, Math.max(y0, site.ny));
    const c = clampIconPoint(nx * width, ny * height, width, height);
    return { nx: c.x / width, ny: c.y / height };
  }

  /**
   * Place piece sites on the truck+trailer silhouette (max 18).
   * Always pins 3 markers on the wheels (1 front + 2 trailer).
   */
  function createSpreadSiteLayout(count, width, height) {
    count = Math.min(18, count);
    const xb = iconXBounds(width);
    const minX = xb.minX / width;
    const maxX = xb.maxX / width;
    const spanX = Math.max(0.01, maxX - minX);
    const sampleMinY = TRUCK_TOP_CAB;
    const sampleMaxY = TRUCK_WHEEL_BOTTOM;
    const spanY = Math.max(0.01, sampleMaxY - sampleMinY);
    const minDistPx = ICON_SIZE_PX + ICON_GAP_PX;
    const minDistPx2 = minDistPx * minDistPx;
    const candidates = Math.max(280, count * 100);
    const sites = [];
    const wheelCount = Math.min(3, count);

    function pixelDist2(a, b) {
      const dx = (a.nx - b.nx) * width;
      const dy = (a.ny - b.ny) * height;
      return dx * dx + dy * dy;
    }

    function overlapsAny(p, list) {
      for (const s of list) {
        if (pixelDist2(p, s) < minDistPx2) return true;
      }
      return false;
    }

    function clampSite(p) {
      const c = clampIconPoint(p.nx * width, p.ny * height, width, height);
      return { nx: c.x / width, ny: c.y / height };
    }

    function alignmentPenalty(p) {
      let penalty = 0;
      for (const s of sites) {
        const dx = Math.abs(p.nx - s.nx);
        const dy = Math.abs(p.ny - s.ny);
        if (dx < spanX * 0.055) penalty += (spanX * 0.055 - dx) * 14;
        if (dy < spanY * 0.07) penalty += (spanY * 0.07 - dy) * 14;
      }
      return penalty;
    }

    // 1) Mandatory wheel markers first.
    for (let w = 0; w < wheelCount; w++) {
      sites.push(sampleWheelSite(w, width, height, sites, minDistPx2));
    }

    // 2) Remaining markers on the body (not on wheels).
    for (let i = wheelCount; i < count; i++) {
      let best = null;
      let bestScore = -Infinity;
      for (let c = 0; c < candidates; c++) {
        const p = {
          nx: minX + Math.random() * spanX,
          ny: sampleMinY + Math.random() * spanY,
        };
        if (!isValidIconSite(p.nx, p.ny, width, height)) continue;
        if (isOnWheel(p.nx, p.ny)) continue;
        if (overlapsAny(p, sites)) continue;
        let nearest = Infinity;
        for (const s of sites) nearest = Math.min(nearest, pixelDist2(p, s));
        const spreadScore = sites.length
          ? Math.sqrt(nearest)
          : Math.random() * minDistPx;
        const onCabBody =
          p.nx < TRUCK_CAB_END_X && p.ny < TRUCK_CHASSIS_BOTTOM
            ? minDistPx * 0.15
            : 0;
        const score =
          spreadScore +
          Math.random() * minDistPx * 0.9 +
          onCabBody -
          alignmentPenalty(p) * width * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }

      if (!best) {
        for (let attempt = 0; attempt < 500 && !best; attempt++) {
          const t = attempt / 500;
          const ang = attempt * 2.399;
          const rad = t * Math.max(spanX, spanY);
          const p = clampSite({
            nx: minX + spanX * 0.5 + Math.cos(ang) * rad * spanX,
            ny: sampleMinY + spanY * 0.4 + Math.sin(ang) * rad * spanY,
          });
          if (
            isValidIconSite(p.nx, p.ny, width, height) &&
            !isOnWheel(p.nx, p.ny) &&
            !overlapsAny(p, sites)
          ) {
            best = p;
          }
        }
      }

      if (!best) {
        // Last resort: no candidate cleared minDistPx at all. Rather than
        // dropping a point blind (which could land right on top of another
        // icon), pick whichever of a fresh batch of valid, on-truck,
        // off-wheel candidates ends up farthest from its nearest neighbour.
        let fallbackBest = null;
        let fallbackBestNearest = -Infinity;
        for (let c = 0; c < candidates; c++) {
          const p = {
            nx: minX + Math.random() * spanX,
            ny: sampleMinY + Math.random() * spanY,
          };
          if (!isValidIconSite(p.nx, p.ny, width, height)) continue;
          if (isOnWheel(p.nx, p.ny)) continue;
          let nearest = Infinity;
          for (const s of sites) nearest = Math.min(nearest, pixelDist2(p, s));
          if (nearest > fallbackBestNearest) {
            fallbackBestNearest = nearest;
            fallbackBest = p;
          }
        }
        best =
          fallbackBest ||
          clampSite({
            nx: minX + ((i + 0.5) / count) * spanX,
            ny: TRUCK_TOP_CAB + 0.12 + (i % 3) * 0.08,
          });
      }
      sites.push(clampSite(best));
    }

    // Resolve overlaps; keep the first wheelCount sites on wheels. A pushed
    // point is only kept if it's still a valid on-truck (or on-wheel) spot —
    // otherwise two icons might stay squeezed together rather than one of
    // them getting shoved into the background.
    for (let iter = 0; iter < 150; iter++) {
      let moved = false;
      for (let i = 0; i < sites.length; i++) {
        let fx = 0;
        let fy = 0;
        for (let j = 0; j < sites.length; j++) {
          if (i === j) continue;
          const dx = (sites[i].nx - sites[j].nx) * width;
          const dy = (sites[i].ny - sites[j].ny) * height;
          const d2 = dx * dx + dy * dy + 1e-4;
          const d = Math.sqrt(d2);
          if (d >= minDistPx) continue;
          const push = ((minDistPx - d) / minDistPx) * 0.55;
          fx += (dx / d) * push;
          fy += (dy / d) * push;
          moved = true;
        }
        if (fx || fy) {
          const next =
            i < wheelCount
              ? snapToWheelSlot(clampSite({
                  nx: sites[i].nx + fx / width,
                  ny: sites[i].ny + fy / height,
                }), i, width, height)
              : clampSite({
                  nx: sites[i].nx + fx / width,
                  ny: sites[i].ny + fy / height,
                });
          const stillValid =
            i < wheelCount
              ? isOnWheel(next.nx, next.ny) &&
                isValidIconSite(next.nx, next.ny, width, height)
              : isValidIconSite(next.nx, next.ny, width, height) &&
                !isOnWheel(next.nx, next.ny);
          if (stillValid) sites[i] = next;
        }
      }
      if (!moved) break;
    }

    for (let i = 0; i < wheelCount; i++) {
      sites[i] = snapToWheelSlot(sites[i], i, width, height);
    }

    for (let i = wheelCount; i < sites.length; i++) {
      for (let t = 0; t < 8; t++) {
        const trial = clampSite({
          nx: sites[i].nx + (Math.random() - 0.5) * spanX * 0.04,
          ny: sites[i].ny + (Math.random() - 0.5) * spanY * 0.05,
        });
        if (
          isValidIconSite(trial.nx, trial.ny, width, height) &&
          !isOnWheel(trial.nx, trial.ny) &&
          !overlapsAny(
            trial,
            sites.filter((_, idx) => idx !== i)
          )
        ) {
          sites[i] = trial;
          break;
        }
      }
    }

    return sites;
  }

  /** Draw like CSS object-fit: cover — fill the scene, crop overflow. */
  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih || !dw || !dh) return;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (iw - sw) * 0.5;
    const sy = (ih - sh) * 0.5;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function polygonBBox(polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function clearLayers() {
    svgLayer.innerHTML = "";
    iconsLayer.innerHTML = "";
    vfxLayer.innerHTML = "";
    cellPolygons.clear();
    clearedDustMasks.length = 0;
    if (dustCanvas) {
      dustCanvas.remove();
      dustCanvas = null;
      dustCtx = null;
    }
    dustBase = null;
  }

  function ensureDustLayer(width, height) {
    // Dirt / dust overlay removed.
    if (dustCanvas) {
      dustCanvas.remove();
      dustCanvas = null;
      dustCtx = null;
    }
    dustBase = null;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paintDustAndWebs(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    const rnd = mulberry32(91 + pieceCount * 13);
    const minSide = Math.min(width, height);

    const haze = ctx.createRadialGradient(
      width * 0.45,
      height * 0.35,
      minSide * 0.1,
      width * 0.5,
      height * 0.5,
      minSide * 0.85
    );
    haze.addColorStop(0, "rgba(185, 170, 145, 0.14)");
    haze.addColorStop(0.45, "rgba(140, 125, 100, 0.22)");
    haze.addColorStop(1, "rgba(75, 62, 48, 0.34)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 3; i++) {
      const wx = width * (0.12 + i * 0.28);
      const shaft = ctx.createLinearGradient(wx, 0, wx + width * 0.08, height);
      shaft.addColorStop(0, "rgba(210, 200, 175, 0.1)");
      shaft.addColorStop(0.55, "rgba(180, 165, 140, 0.04)");
      shaft.addColorStop(1, "rgba(180, 165, 140, 0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(wx - 20, 0);
      ctx.lineTo(wx + width * 0.1, 0);
      ctx.lineTo(wx + width * 0.18, height);
      ctx.lineTo(wx - width * 0.02, height);
      ctx.closePath();
      ctx.fill();
    }

    for (let i = 0; i < 90; i++) {
      const x = rnd() * width;
      const y = rnd() * height;
      const r = 20 + rnd() * 75;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + rnd() * 0.12;
      g.addColorStop(0, "rgba(165, 148, 120, " + a + ")");
      g.addColorStop(1, "rgba(165, 148, 120, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < Math.floor(width * height * 0.0014); i++) {
      const x = rnd() * width;
      const y = rnd() * height;
      ctx.fillStyle = "rgba(220, 205, 175, " + (0.12 + rnd() * 0.28) + ")";
      const s = 0.7 + rnd() * 1.8;
      ctx.fillRect(x, y, s, s * (0.4 + rnd() * 0.9));
    }
  }

  /**
   * Redraw dust from the pristine base, then punch holes for cleaned areas.
   * Optional live wipe hole: soft cell ∩ cleared part of wipe matte.
   */
  function redrawDust(liveSoft, liveKeepMatte, brushRect) {
    if (!dustCtx || !dustBase) return;
    const w = dustCanvas.width;
    const h = dustCanvas.height;
    dustCtx.setTransform(1, 0, 0, 1, 0, 0);
    dustCtx.globalCompositeOperation = "source-over";
    dustCtx.globalAlpha = 1;
    dustCtx.clearRect(0, 0, w, h);
    dustCtx.drawImage(dustBase, 0, 0);

    dustCtx.globalCompositeOperation = "destination-out";
    clearedDustMasks.forEach((mask) => {
      dustCtx.drawImage(mask, 0, 0);
    });

    if (liveSoft && liveKeepMatte && brushRect) {
      const hole = document.createElement("canvas");
      hole.width = w;
      hole.height = h;
      const hctx = hole.getContext("2d");
      // White where wipe has already cleared inside the brush footprint.
      hctx.fillStyle = "#fff";
      hctx.fillRect(brushRect.x, brushRect.y, brushRect.w, brushRect.h);
      hctx.globalCompositeOperation = "destination-out";
      hctx.drawImage(
        liveKeepMatte,
        brushRect.x,
        brushRect.y,
        brushRect.w,
        brushRect.h
      );
      // Limit to the soft cell silhouette.
      hctx.globalCompositeOperation = "destination-in";
      hctx.drawImage(liveSoft, 0, 0);
      dustCtx.drawImage(hole, 0, 0);
    } else if (liveSoft) {
      dustCtx.drawImage(liveSoft, 0, 0);
    }

    dustCtx.globalCompositeOperation = "source-over";
  }

  function commitDustHole(softMask) {
    if (!softMask) return;
    clearedDustMasks.push(softMask);
    redrawDust();
  }

  /**
   * Warps a shape's outline into a smooth wavy line. Both noise fields are
   * functions of stage position only, so two pieces sharing a border get warped
   * identically and their borders stay glued together.
   */
  function buildEdgeWarpFilter(id, width, height, warp) {
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", String(-EDGE_PAD));
    filter.setAttribute("y", String(-EDGE_PAD));
    filter.setAttribute("width", String(width + EDGE_PAD * 2));
    filter.setAttribute("height", String(height + EDGE_PAD * 2));

    const swellNoise = document.createElementNS(SVG_NS, "feTurbulence");
    swellNoise.setAttribute("type", "fractalNoise");
    swellNoise.setAttribute("baseFrequency", warp.frequency.toFixed(5));
    swellNoise.setAttribute("numOctaves", "2");
    swellNoise.setAttribute("seed", "7");
    swellNoise.setAttribute("result", "swellNoise");

    const swell = document.createElementNS(SVG_NS, "feDisplacementMap");
    swell.setAttribute("in", "SourceGraphic");
    swell.setAttribute("in2", "swellNoise");
    swell.setAttribute("scale", String(warp.swell));
    swell.setAttribute("xChannelSelector", "R");
    swell.setAttribute("yChannelSelector", "G");
    swell.setAttribute("result", "swelled");

    const rippleNoise = document.createElementNS(SVG_NS, "feTurbulence");
    rippleNoise.setAttribute("type", "fractalNoise");
    rippleNoise.setAttribute("baseFrequency", (warp.frequency * 3.2).toFixed(5));
    rippleNoise.setAttribute("numOctaves", "2");
    rippleNoise.setAttribute("seed", "23");
    rippleNoise.setAttribute("result", "rippleNoise");

    const crinkle = document.createElementNS(SVG_NS, "feDisplacementMap");
    crinkle.setAttribute("in", "swelled");
    crinkle.setAttribute("in2", "rippleNoise");
    crinkle.setAttribute("scale", String(warp.ripple));
    crinkle.setAttribute("xChannelSelector", "R");
    crinkle.setAttribute("yChannelSelector", "G");
    crinkle.setAttribute("result", "crinkled");

    const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
    blur.setAttribute("in", "crinkled");
    blur.setAttribute("stdDeviation", String(EDGE_FADE));

    filter.appendChild(swellNoise);
    filter.appendChild(swell);
    filter.appendChild(rippleNoise);
    filter.appendChild(crinkle);
    filter.appendChild(blur);

    return filter;
  }

  function edgeWarpSettings(width, height) {
    const cellSize = Math.sqrt((width * height) / pieceCount);
    return {
      swell: Math.min(72, Math.max(28, cellSize * 0.3)),
      ripple: Math.min(22, Math.max(9, cellSize * 0.09)),
      frequency: 1.35 / cellSize,
    };
  }

  function appendSharedDefs(defs, width, height) {
    const warp = edgeWarpSettings(width, height);
    defs.appendChild(buildEdgeWarpFilter("cell-edge", width, height, warp));
  }

  /** Smooth value-noise in stage space so shared borders displace identically. */
  function edgeField(x, y) {
    return (
      Math.sin(x * 0.028 + y * 0.023) * 0.5 +
      Math.sin(x * 0.051 - y * 0.037) * 0.32 +
      Math.sin(x * 0.013 + y * 0.061) * 0.18
    );
  }

  function edgeField2(x, y) {
    return (
      Math.sin(x * 0.033 - y * 0.019) * 0.5 +
      Math.sin(x * 0.017 + y * 0.044) * 0.35 +
      Math.sin(x * 0.058 + y * 0.011) * 0.15
    );
  }

  /**
   * Densify polygon edges, wave them with stage-space noise (no straight runs),
   * then emit a Catmull-Rom-smoothed path. Neighbours stay sealed because the
   * displacement depends only on absolute position.
   */
  function organicCellPath(polygon, cornerRadius, waveAmp) {
    const rounded = densifyRoundedPolygon(polygon, cornerRadius, EDGE_STEP);
    if (rounded.length < 3) return "";

    const waved = rounded.map((p) => ({
      x: p.x + edgeField(p.x, p.y) * waveAmp,
      y: p.y + edgeField2(p.x, p.y) * waveAmp,
    }));

    return catmullRomPath(waved);
  }

  function densifyRoundedPolygon(polygon, radius, step) {
    const n = polygon.length;
    if (n < 3) return polygon.slice();

    const corners = [];
    for (let i = 0; i < n; i++) {
      const prev = polygon[(i + n - 1) % n];
      const curr = polygon[i];
      const next = polygon[(i + 1) % n];

      const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y) || 1;
      const outLen = Math.hypot(next.x - curr.x, next.y - curr.y) || 1;
      const rIn = Math.min(radius, inLen * 0.42);
      const rOut = Math.min(radius, outLen * 0.42);

      const start = {
        x: curr.x - ((curr.x - prev.x) / inLen) * rIn,
        y: curr.y - ((curr.y - prev.y) / inLen) * rIn,
      };
      const end = {
        x: curr.x + ((next.x - curr.x) / outLen) * rOut,
        y: curr.y + ((next.y - curr.y) / outLen) * rOut,
      };

      // Approximate the corner curve with a few samples so it is not a hard tip.
      corners.push(start);
      for (let t = 1; t <= 3; t++) {
        const u = t / 4;
        const omu = 1 - u;
        corners.push({
          x: omu * omu * start.x + 2 * omu * u * curr.x + u * u * end.x,
          y: omu * omu * start.y + 2 * omu * u * curr.y + u * u * end.y,
        });
      }
      corners.push(end);
    }

    const dense = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      dense.push(a);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const segs = Math.max(1, Math.ceil(len / step));
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        dense.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
      }
    }
    return dense;
  }

  function catmullRomPath(points) {
    const n = points.length;
    if (n < 2) return "";
    let d = `M ${fmt(points[0])}`;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const c1 = {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
      };
      const c2 = {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
      };
      d += ` C ${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
    }
    return `${d} Z`;
  }

  function fmt(p) {
    return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }

  function edgeOutlinePath(cell) {
    return organicCellPath(
      VoronoiReveal.expandPolygon(cell.polygon, FEATHER),
      CORNER_RADIUS,
      EDGE_WAVE
    );
  }

  function createEdgeMask(defs, cell, width, height) {
    const mask = document.createElementNS(SVG_NS, "mask");
    mask.setAttribute("id", `cell-edge-mask-${cell.index}`);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", String(-EDGE_PAD));
    mask.setAttribute("y", String(-EDGE_PAD));
    mask.setAttribute("width", String(width + EDGE_PAD * 2));
    mask.setAttribute("height", String(height + EDGE_PAD * 2));

    const outline = document.createElementNS(SVG_NS, "path");
    outline.setAttribute("d", edgeOutlinePath(cell));
    outline.setAttribute("fill", "#fff");
    outline.setAttribute("filter", "url(#cell-edge)");
    mask.appendChild(outline);
    defs.appendChild(mask);
  }

  function buildScene() {
    const { width, height } = getStageSize();
    if (width === layoutWidth && height === layoutHeight && svgLayer.childElementCount > 0) {
      return;
    }
    layoutWidth = width;
    layoutHeight = height;

    clearedCount = 0;
    const budget = budgetForPieceCount(pieceCount);
    currency = budget;
    setCurrencyDisplay(budget, true);
    rewardScreen.hidden = true;
    rewardScreen.classList.remove("is-visible");

    clearLayers();

    svgLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgLayer.setAttribute("preserveAspectRatio", "xMidYMid slice");

    const defs = document.createElementNS(SVG_NS, "defs");
    svgLayer.appendChild(defs);
    appendSharedDefs(defs, width, height);

    const piecesRoot = document.createElementNS(SVG_NS, "g");
    piecesRoot.classList.add("pieces-layer");
    svgLayer.appendChild(piecesRoot);

    if (!siteLayout) {
      siteLayout = createSpreadSiteLayout(pieceCount, width, height);
    }
    const cells = VoronoiReveal.computeVoronoi(
      pieceCount,
      width,
      height,
      siteLayout,
      EDGE_PAD_PX
    );
    const cellCosts = costsFromCellAreas(cells);

    cells.forEach((cell) => {
      cellPolygons.set(cell.index, cell.polygon);
      createEdgeMask(defs, cell, width, height);

      const group = document.createElementNS(SVG_NS, "g");
      group.classList.add("cell");
      group.dataset.cellId = String(cell.index);

      const image = document.createElementNS(SVG_NS, "image");
      image.setAttributeNS(XLINK_NS, "href", stateAUrl);
      image.setAttribute("href", stateAUrl);
      image.setAttribute("x", "0");
      image.setAttribute("y", "0");
      image.setAttribute("width", String(width));
      image.setAttribute("height", String(height));
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      image.setAttribute("mask", `url(#cell-edge-mask-${cell.index})`);

      group.appendChild(image);
      piecesRoot.appendChild(group);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell-icon";
      btn.dataset.cellId = String(cell.index);
      const clamped = clampIconPoint(cell.site.x, cell.site.y, width, height);
      btn.style.left = `${clamped.x}px`;
      btn.style.top = `${clamped.y}px`;
      btn.setAttribute("aria-label", `Reveal piece ${cell.index + 1}`);

      const plate = document.createElement("span");
      plate.className = "cell-icon-plate";
      btn.appendChild(plate);

      const iconImg = document.createElement("img");
      iconImg.className = "cell-icon-sku";
      iconImg.src = iconUrl;
      iconImg.alt = "";
      iconImg.draggable = false;
      btn.appendChild(iconImg);

      const cost = cellCosts[cell.index];
      const iconLabel = document.createElement("span");
      iconLabel.className = "cell-icon-label";
      iconLabel.textContent = String(cost);
      btn.dataset.cost = String(cost);
      btn.appendChild(iconLabel);

      btn.addEventListener("click", (event) => onIconTap(cell.index, event));
      iconsLayer.appendChild(btn);
    });

    // Dust/dirt overlay disabled.
    // ensureDustLayer(width, height);
  }

  /** Map Voronoi piece areas to integer costs — larger piece → higher cost. */
  function costsFromCellAreas(cells) {
    const budget = budgetForPieceCount(pieceCount);
    const areas = cells.map((cell) =>
      Math.max(1, VoronoiReveal.polygonArea(cell.polygon))
    );
    const total = areas.reduce((sum, a) => sum + a, 0);
    const raw = areas.map((a) => (a / total) * budget);
    const costs = raw.map((v) => Math.max(1, Math.round(v)));

    // Fix rounding so costs sum to the mode budget.
    let diff = budget - costs.reduce((sum, c) => sum + c, 0);
    const order = areas
      .map((a, i) => ({ a, i }))
      .sort((x, y) => y.a - x.a);
    let guard = 0;
    while (diff !== 0 && guard < 1000) {
      const idx = order[guard % order.length].i;
      if (diff > 0) {
        costs[idx] += 1;
        diff -= 1;
      } else if (costs[idx] > 1) {
        costs[idx] -= 1;
        diff += 1;
      }
      guard += 1;
    }
    return costs;
  }

  /**
   * Soft cell silhouette matching the SVG edge masks (feather + blur),
   * so the wipe never flashes hard polygon edges.
   */
  function buildSoftCellMask(width, height, polygon) {
    const soft = document.createElement("canvas");
    soft.width = width;
    soft.height = height;
    const sctx = soft.getContext("2d");

    const outline = organicCellPath(
      VoronoiReveal.expandPolygon(polygon, FEATHER),
      CORNER_RADIUS,
      EDGE_WAVE
    );
    const path = new Path2D(outline);

    sctx.filter = `blur(${EDGE_FADE}px)`;
    sctx.fillStyle = "#fff";
    sctx.fill(path);
    sctx.filter = "none";

    return soft;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const intersects =
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function randomPointInPolygon(polygon) {
    const bbox = polygonBBox(polygon);
    for (let i = 0; i < 24; i++) {
      const candidate = {
        x: bbox.minX + Math.random() * bbox.width,
        y: bbox.minY + Math.random() * bbox.height,
      };
      if (pointInPolygon(candidate, polygon)) return candidate;
    }
    return {
      x: (bbox.minX + bbox.maxX) / 2,
      y: (bbox.minY + bbox.maxY) / 2,
    };
  }

  /**
   * Reference splash VFX at the tap point (from Video Preview H264.mp4).
   */
  let spongeSparklesLayer = null;
  function ensureSpongeSparklesLayer() {
    if (!spongeSparklesLayer) {
      spongeSparklesLayer = document.createElement("div");
      spongeSparklesLayer.className = "sponge-sparkles";
      playArea.appendChild(spongeSparklesLayer);
    }
    return spongeSparklesLayer;
  }

  /** Small four-point sparkle burst at a point (used right after the splash). */
  function playSparkleFx(cx, cy, diameter) {
    const layer = ensureSpongeSparklesLayer();
    const size = Math.max(90, Math.min(220, diameter));
    const count = 7;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = "sponge-sparkle";
      const angle = Math.random() * Math.PI * 2;
      const dist = size * (0.12 + Math.random() * 0.28);
      const sparkleSize = size * (0.14 + Math.random() * 0.16);
      const dur = 420 + Math.random() * 260;
      const delay = Math.random() * 120;
      el.style.left = `${cx + Math.cos(angle) * dist}px`;
      el.style.top = `${cy + Math.sin(angle) * dist}px`;
      el.style.width = `${sparkleSize}px`;
      el.style.height = `${sparkleSize}px`;
      el.style.setProperty("--sparkle-dur", `${dur}ms`);
      el.style.setProperty("--sparkle-delay", `${delay}ms`);
      layer.appendChild(el);
      window.setTimeout(() => el.remove(), delay + dur + 40);
    }
  }

  /** Small water droplets flying from (ox,oy) — the sprayer — to (tx,ty) — the piece. */
  function playSpraySquirtFx(ox, oy, tx, ty) {
    const dx = tx - ox;
    const dy = ty - oy;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    const dropletCount = 7;
    for (let i = 0; i < dropletCount; i++) {
      const el = document.createElement("span");
      el.className = "spray-droplet";
      const spread = (Math.random() - 0.5) * 0.4;
      const cosA = Math.cos(spread);
      const sinA = Math.sin(spread);
      const dirX = ux * cosA - uy * sinA;
      const dirY = ux * sinA + uy * cosA;
      const travel = dist * (0.72 + Math.random() * 0.32);
      const size = 9 + Math.random() * 8;
      const dur = 220 + Math.random() * 120;
      el.style.left = `${ox}px`;
      el.style.top = `${oy}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.setProperty("--dx", `${dirX * travel}px`);
      el.style.setProperty("--dy", `${dirY * travel}px`);
      el.style.animationDuration = `${dur}ms`;
      el.style.animationDelay = `${Math.random() * 40}ms`;
      vfxLayer.appendChild(el);
      window.setTimeout(() => el.remove(), dur + 80);
    }
  }

  function createHoseSprayFx(polygon, splashAt) {
    const bbox = polygonBBox(polygon);
    const pieceCx = (bbox.minX + bbox.maxX) / 2;
    const pieceCy = (bbox.minY + bbox.maxY) / 2;
    const ox =
      splashAt && Number.isFinite(splashAt.x) ? splashAt.x : pieceCx;
    const oy =
      splashAt && Number.isFinite(splashAt.y) ? splashAt.y : pieceCy;
    const size = Math.max(
      130,
      Math.min(300, Math.hypot(bbox.width, bbox.height) * 0.75)
    );
    playSplashFx(ox, oy, size);
    window.setTimeout(() => playSparkleFx(ox, oy, size), SPLASH_MS);
    return { remove() {} };
  }

  function wipeFrameIndex(t) {
    const last = WIPE_FRAME_COUNT - 1;
    return Math.min(last, Math.max(0, Math.round(t * last)));
  }

  /**
   * Soft keep-matte from wipe.mp4 over the whole piece — organic brush texture,
   * heavily feathered so no hard rectangle / boundary is visible.
   */
  function buildSoftWipeKeep(width, height, matteImg, pieceRect, feather) {
    const keep = document.createElement("canvas");
    keep.width = width;
    keep.height = height;
    const kctx = keep.getContext("2d");
    // Start fully opaque (dirt everywhere), then punch with wipe clear amount.
    kctx.fillStyle = "#fff";
    kctx.fillRect(0, 0, width, height);
    if (!matteImg) return keep;

    const { x, y, w, h } = pieceRect;
    const softMatte = document.createElement("canvas");
    softMatte.width = width;
    softMatte.height = height;
    const mctx = softMatte.getContext("2d");

    // Draw wipe matte across the piece, then blur so edges dissolve.
    mctx.filter = "blur(" + Math.max(6, feather) + "px)";
    mctx.drawImage(matteImg, x, y, w, h);
    mctx.filter = "none";

    // Soft radial falloff at piece rim (no hard clip box).
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const rx = w * 0.62;
    const ry = h * 0.62;
    const falloff = document.createElement("canvas");
    falloff.width = width;
    falloff.height = height;
    const fctx = falloff.getContext("2d");
    const grad = fctx.createRadialGradient(
      cx,
      cy,
      Math.min(rx, ry) * 0.2,
      cx,
      cy,
      Math.max(rx, ry)
    );
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = grad;
    fctx.fillRect(0, 0, width, height);
    const fallBlur = document.createElement("canvas");
    fallBlur.width = width;
    fallBlur.height = height;
    const fb = fallBlur.getContext("2d");
    fb.filter = "blur(" + Math.max(8, feather * 0.7) + "px)";
    fb.drawImage(falloff, 0, 0);
    fb.filter = "none";

    // erase = falloff * (1 - matteKeep)  → transparent dirt where wipe cleared
    const erase = document.createElement("canvas");
    erase.width = width;
    erase.height = height;
    const ectx = erase.getContext("2d");
    ectx.drawImage(fallBlur, 0, 0);
    ectx.globalCompositeOperation = "destination-out";
    ectx.drawImage(softMatte, 0, 0);

    kctx.globalCompositeOperation = "destination-out";
    kctx.drawImage(erase, 0, 0);
    kctx.globalCompositeOperation = "source-over";
    return keep;
  }

  /**
   * Clears a piece with the wipe.mp4 dry-brush matte (no hard edges).
   */
  function startBrushWipe(cellId, onDone) {
    const polygon = cellPolygons.get(cellId);
    const cellEl = svgLayer.querySelector('.cell[data-cell-id="' + cellId + '"]');
    if (!polygon || !cellEl) {
      onDone();
      return;
    }

    if (!stateAImage.complete || stateAImage.naturalWidth === 0) {
      cellEl.classList.add("is-gone");
      commitDustHole(buildSoftCellMask(layoutWidth, layoutHeight, polygon));
      onDone();
      return;
    }

    const width = layoutWidth;
    const height = layoutHeight;
    const softEdge = buildSoftCellMask(width, height, polygon);
    const bbox = polygonBBox(polygon);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.className = "brush-wipe-canvas";
    vfxLayer.appendChild(canvas);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let finished = false;
    let svgHidden = false;
    let rafId = 0;
    let clearestIdx = 0;
    const wipeClockStart = performance.now();

    function wipeProgress() {
      return Math.min(
        1,
        Math.max(0, (performance.now() - wipeClockStart) / WIPE_MS)
      );
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(rafId);
      canvas.remove();
      commitDustHole(softEdge);
      onDone();
    }

    function renderFrame() {
      const t = wipeProgress();
      const idx = t >= 0.92 ? WIPE_FRAME_COUNT - 1 : wipeFrameIndex(t);
      clearestIdx = Math.max(clearestIdx, idx);
      const matteImg = wipeReady ? wipeFrames[clearestIdx] : null;

      const pad = Math.max(18, Math.min(bbox.width, bbox.height) * 0.12);
      const pieceRect = {
        x: bbox.minX - pad,
        y: bbox.minY - pad,
        w: bbox.width + pad * 2,
        h: bbox.height + pad * 2,
      };
      const feather = Math.max(12, Math.min(pieceRect.w, pieceRect.h) * 0.16);

      const softKeep = matteImg
        ? buildSoftWipeKeep(width, height, matteImg, pieceRect, feather)
        : null;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);

      drawImageCover(ctx, stateAImage, 0, 0, width, height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(softEdge, 0, 0);

      if (softKeep) {
        ctx.drawImage(softKeep, 0, 0);
      } else if (t > 0.5) {
        ctx.globalAlpha = Math.max(0, 1 - (t - 0.5) * 2);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";

      if (softKeep) {
        redrawDust(softEdge, softKeep, { x: 0, y: 0, w: width, h: height });
      } else if (t > 0.7) {
        redrawDust(softEdge);
      }

      if (!svgHidden) {
        cellEl.classList.add("is-gone");
        svgHidden = true;
      }
    }

    function tick() {
      if (finished) return;
      renderFrame();
      if (wipeProgress() >= 1) {
        cleanup();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    renderFrame();
    rafId = requestAnimationFrame(tick);
  }

  function setCurrencyDisplay(value, immediate) {
    if (!hudTopCountEl) return;
    currency = value;
    if (immediate) {
      if (currencyAnimRaf) cancelAnimationFrame(currencyAnimRaf);
      currencyAnimRaf = 0;
      displayCurrency = value;
      hudTopCountEl.textContent = String(Math.round(value));
      return;
    }
    animateCurrencyDown(value);
  }

  /** Tick the HUD counter down to the new total. */
  function animateCurrencyDown(target) {
    if (!hudTopCountEl) return;
    if (currencyAnimRaf) cancelAnimationFrame(currencyAnimRaf);

    const start = displayCurrency;
    const end = target;
    if (end >= start) {
      displayCurrency = end;
      hudTopCountEl.textContent = String(Math.round(end));
      currencyAnimRaf = 0;
      return;
    }

    const diff = start - end;
    const duration = Math.min(900, Math.max(380, diff * 14));
    const t0 = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      displayCurrency = start + (end - start) * eased;
      hudTopCountEl.textContent = String(Math.round(displayCurrency));
      if (t < 1) {
        currencyAnimRaf = requestAnimationFrame(tick);
      } else {
        displayCurrency = end;
        hudTopCountEl.textContent = String(end);
        currencyAnimRaf = 0;
      }
    }

    currencyAnimRaf = requestAnimationFrame(tick);
  }

  function onIconTap(cellId, event) {
    const cellEl = svgLayer.querySelector(`.cell[data-cell-id="${cellId}"]`);
    const iconEl = iconsLayer.querySelector(`.cell-icon[data-cell-id="${cellId}"]`);

    if (!cellEl || !iconEl) return;
    if (
      cellEl.classList.contains("is-gone") ||
      cellEl.classList.contains("is-wiping")
    ) {
      return;
    }

    const cost = Number(iconEl.dataset.cost) || 0;
    setCurrencyDisplay(Math.max(0, currency - cost), false);

    cellEl.classList.add("is-wiping");
    iconEl.classList.add("is-fading"); // plate + number vanish now (CSS)
    iconEl.classList.add("is-spraying"); // sprayer plays its 3x squeeze (CSS)

    let splashAt = null;
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const rect = playArea.getBoundingClientRect();
      splashAt = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    const poly = cellPolygons.get(cellId);
    const bbox = poly ? polygonBBox(poly) : null;
    const pieceCx = bbox ? (bbox.minX + bbox.maxX) / 2 : splashAt?.x || 0;
    const pieceCy = bbox ? (bbox.minY + bbox.maxY) / 2 : splashAt?.y || 0;
    const targetX = splashAt ? splashAt.x : pieceCx;
    const targetY = splashAt ? splashAt.y : pieceCy;

    const iconRect = iconEl.getBoundingClientRect();
    const playRect = playArea.getBoundingClientRect();
    const sprayerX = iconRect.left + iconRect.width / 2 - playRect.left;
    const sprayerY = iconRect.top + iconRect.height / 2 - playRect.top;

    const splashSize =
      Math.max(
        90,
        Math.min(220, bbox ? Math.hypot(bbox.width, bbox.height) * 0.55 : 150)
      ) * 0.8;

    /** Is this point actually on the truck silhouette (not sky/background)? */
    function isInsideTruck(nx, ny) {
      if (nx < TRUCK_LEFT_FRAC || nx > TRUCK_RIGHT_FRAC) return false;
      const { top, bot } = truckVerticalRange(nx);
      return ny >= top && ny <= bot;
    }

    /**
     * A different random point inside the piece for each of the 3 sprays —
     * but never past the truck's actual edge, even if the piece's own
     * rectangular bounding box spills onto the background.
     */
    function randomSprayTarget() {
      const w = layoutWidth || 1;
      const h = layoutHeight || 1;
      if (bbox) {
        const insetX = Math.min(bbox.width * 0.22, 40);
        const insetY = Math.min(bbox.height * 0.22, 40);
        for (let attempt = 0; attempt < 12; attempt++) {
          const x =
            bbox.minX + insetX + Math.random() * Math.max(1, bbox.width - insetX * 2);
          const y =
            bbox.minY + insetY + Math.random() * Math.max(1, bbox.height - insetY * 2);
          if (isInsideTruck(x / w, y / h)) return { x, y };
        }
      }
      // Fallback: clamp the click/piece-center point onto the truck itself.
      const nx = Math.min(TRUCK_RIGHT_FRAC, Math.max(TRUCK_LEFT_FRAC, targetX / w));
      const { top, bot } = truckVerticalRange(nx);
      const ny = Math.min(bot, Math.max(top, targetY / h));
      return { x: nx * w, y: ny * h };
    }

    const SPRAY_COUNT = 3;
    const SPRAY_INTERVAL_MS = 260;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      // Fire at the rotation's peak (mid-cycle), not the start of the cycle.
      window.setTimeout(() => {
        const spot = randomSprayTarget();
        playSpraySquirtFx(sprayerX, sprayerY, spot.x, spot.y);
        playSplashFx(spot.x, spot.y, splashSize);
      }, i * SPRAY_INTERVAL_MS + SPRAY_INTERVAL_MS / 2);
    }

    // Only after the 3rd spray does the piece actually start disappearing.
    const spraysDoneMs = (SPRAY_COUNT - 1) * SPRAY_INTERVAL_MS + 260;
    window.setTimeout(() => {
      iconEl.classList.remove("is-spraying");
      iconEl.classList.add("is-gone"); // bottle vanishes right away, not after the wipe
      startBrushWipe(cellId, () => {
        cellEl.classList.remove("is-wiping");
        cellEl.classList.add("is-gone");
        clearedCount += 1;
        if (clearedCount >= pieceCount) {
          startSceneComplete();
        }
      });
    }, spraysDoneMs);
  }

  function formatReward(n) {
    return n.toLocaleString("en-US");
  }

  function clearCelebrate() {
    if (!celebrateLayer) return;
    celebrateLayer.classList.remove("is-active");
    celebrateLayer.innerHTML = "";
  }

  /** Random point on the truck silhouette (same map as number placement). */
  function randomTruckSparklePoint(width, height, padPx) {
    const xb = iconXBounds(width);
    const pad = Math.max(0, padPx || 0);
    for (let i = 0; i < 48; i++) {
      const x =
        xb.minX + pad + Math.random() * Math.max(1, xb.maxX - xb.minX - pad * 2);
      const yb = iconYBoundsAtX(x, width, height);
      const y =
        yb.minY +
        pad +
        Math.random() * Math.max(1, yb.maxY - yb.minY - pad * 2);
      if (isValidIconSite(x / width, y / height, width, height)) {
        return { x, y };
      }
    }
    return clampIconPoint(
      (xb.minX + xb.maxX) * 0.5,
      height * ((TRUCK_TOP_CAB + TRUCK_CHASSIS_BOTTOM) * 0.5),
      width,
      height
    );
  }

  function playCelebrateFx() {
    if (!celebrateLayer) return;
    clearCelebrate();
    celebrateLayer.classList.add("is-active");

    const width = layoutWidth || getStageSize().width;
    const height = layoutHeight || getStageSize().height;

    // Soft glow only over the truck band (not the whole sky).
    const glow = document.createElement("div");
    glow.className = "celebrate-glow";
    const xb = iconXBounds(width);
    const glowLeft = xb.minX - 20;
    const glowRight = xb.maxX + 20;
    const glowTop = height * TRUCK_TOP_CAB - 30;
    const glowBottom = height * TRUCK_WHEEL_BOTTOM + 10;
    const glowW = Math.max(40, glowRight - glowLeft);
    const glowH = Math.max(40, glowBottom - glowTop);
    glow.style.left = `${glowLeft}px`;
    glow.style.top = `${glowTop}px`;
    glow.style.width = `${glowW}px`;
    glow.style.height = `${glowH}px`;
    celebrateLayer.appendChild(glow);

    const count = 42;
    for (let i = 0; i < count; i++) {
      const kind = Math.random();
      const el = document.createElement("div");
      const size =
        kind < 0.3
          ? 18 + Math.random() * 12
          : kind < 0.65
            ? 13 + Math.random() * 9
            : 8 + Math.random() * 6;
      const pt = randomTruckSparklePoint(width, height, size * 0.4);
      el.className =
        kind < 0.4
          ? "celebrate-sparkle is-star"
          : kind < 0.72
            ? "celebrate-sparkle is-glint"
            : "celebrate-sparkle is-twinkle";
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.left = `${pt.x}px`;
      el.style.top = `${pt.y}px`;
      el.style.setProperty("--spark-delay", `${Math.random() * 1000}ms`);
      el.style.setProperty("--spark-dur", `${840 + Math.random() * 960}ms`);
      el.style.setProperty("--spark-rot", `${Math.random() * 40 - 20}deg`);
      celebrateLayer.appendChild(el);
    }
  }

  function showRewardScreen() {
    const scene = SCENES[sceneIndex];
    if (rewardCoinsEl) rewardCoinsEl.textContent = formatReward(scene.coins);
    if (rewardGemsEl) rewardGemsEl.textContent = formatReward(scene.gems);

    rewardScreen.hidden = false;
    rewardOpen = true;
    requestAnimationFrame(() => {
      rewardScreen.classList.add("is-visible");
    });
  }

  function startSceneComplete() {
    if (celebrating || rewardOpen) return;
    celebrating = true;
    playCelebrateFx();
    window.setTimeout(() => {
      clearCelebrate();
      celebrating = false;
      showRewardScreen();
    }, CELEBRATE_MS);
  }

  function loadNextScene() {
    if (!rewardOpen) return;
    rewardOpen = false;
    rewardScreen.classList.remove("is-visible");
    window.setTimeout(() => {
      rewardScreen.hidden = true;
      sceneIndex = (sceneIndex + 1) % SCENES.length;
      applySceneArt(SCENES[sceneIndex]);
      siteLayout = null;
      layoutWidth = 0;
      layoutHeight = 0;
      buildScene();
    }, 420);
  }

  function regenerate(count) {
    pieceCount = Math.min(18, count);
    siteLayout = null;
    layoutWidth = 0;
    layoutHeight = 0;
    clearCelebrate();
    celebrating = false;
    rewardOpen = false;
    rewardScreen.classList.remove("is-visible");
    rewardScreen.hidden = true;
    buildScene();
  }

  function init() {
    buildScene();

    rewardScreen.addEventListener("click", loadNextScene);

    controls.addEventListener("click", (event) => {
      const btn = event.target.closest(".control-btn");
      if (!btn) return;
      controls
        .querySelectorAll(".control-btn")
        .forEach((el) => el.classList.toggle("is-active", el === btn));
      regenerate(Number(btn.dataset.pieces));
    });

    const ro = new ResizeObserver(() => {
      buildScene();
    });
    ro.observe(playArea);

    window.addEventListener("orientationchange", () => {
      window.setTimeout(buildScene, 100);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
