/**
 * Fits the decorative iPhone body to the window and exposes the result as
 * --screen-w, which css/styles.css uses to size .device (and, from that,
 * the bezel, buttons and Dynamic Island via calc()).
 *
 * On an actual phone the mock-up chrome is pointless (the browser already
 * gives you a real device edge), so it's hidden via the .is-bare class and
 * the screen is sized to fill the real viewport instead.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var controls = document.getElementById("controls");

  // Opened from the iPhone Home Screen it runs full screen, without Safari bars.
  [
    ["apple-mobile-web-app-capable", "yes"],
    ["mobile-web-app-capable", "yes"],
    ["apple-mobile-web-app-status-bar-style", "black-translucent"],
    ["theme-color", "#000000"],
  ].forEach(function (m) {
    if (document.querySelector('meta[name="' + m[0] + '"]')) return;
    var el = document.createElement("meta");
    el.name = m[0];
    el.content = m[1];
    document.head.appendChild(el);
  });

  // "Turn your phone" hint, shown only on a real phone held upright.
  var hint = document.createElement("div");
  hint.className = "rotate-hint";
  hint.setAttribute("aria-live", "polite");
  hint.innerHTML =
    '<div class="rotate-hint-phone" aria-hidden="true"></div>' +
    "<div>\u041f\u043e\u0432\u0435\u0440\u043d\u0438\u0442\u0435 \u0442\u0435\u043b\u0435\u0444\u043e\u043d \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u043e</div>";
  document.body.insertBefore(hint, document.body.firstChild);

  // Fallback only — the real values live in --device-width/--device-height
  // in css/styles.css, and app.js updates them at runtime to match the
  // actual state1/state2 image aspect ratio once it loads.
  var DEVICE_W_FALLBACK = 2868;
  var DEVICE_H_FALLBACK = 1420;

  // Must match the 0.017 bezel fraction used in .iphone's padding.
  var BEZEL_FRAC = 0.017;
  var BODY_WIDTH_FACTOR = 1 + 2 * BEZEL_FRAC;

  // How much smaller than "as large as technically fits" to render the
  // mock-up, so it doesn't look cramped against the window edges.
  var PHONE_SIZE = 0.85;
  var MIN_SCREEN_W = 200;

  function readDeviceSize() {
    var cs = getComputedStyle(root);
    var w = parseFloat(cs.getPropertyValue("--device-width"));
    var h = parseFloat(cs.getPropertyValue("--device-height"));
    return {
      w: w > 0 ? w : DEVICE_W_FALLBACK,
      h: h > 0 ? h : DEVICE_H_FALLBACK,
    };
  }

  function isRealPhone() {
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    return coarse && Math.min(window.innerWidth, window.innerHeight) < 600;
  }

  function fit() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var device = readDeviceSize();
    var screenRatioH = device.h / device.w;
    var bodyHeightFactor = screenRatioH + 2 * BEZEL_FRAC;
    var screenW;

    // Real phone held upright: the game is landscape, so ask to turn it.
    root.classList.toggle("is-portrait", isRealPhone() && h > w);

    if (isRealPhone()) {
      root.classList.add("is-bare");
      // No bezel on a real phone: fit the screen content directly.
      screenW = Math.min(w, h / screenRatioH);
    } else {
      root.classList.remove("is-bare");
      var controlsH = controls ? controls.offsetHeight + 28 + 30 : 0;
      var byWidth = (w - 32) / BODY_WIDTH_FACTOR;
      var byHeight = (h - controlsH - 40) / bodyHeightFactor;
      screenW = Math.max(MIN_SCREEN_W, Math.min(byWidth, byHeight) * PHONE_SIZE);
    }

    root.style.setProperty("--screen-w", screenW.toFixed(2) + "px");
  }

  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", function () {
    window.setTimeout(fit, 100);
  });
  // app.js dispatches this once it learns the real image aspect ratio and
  // updates --device-width/--device-height, so the phone body re-fits.
  window.addEventListener("scene-aspect-ready", fit);
})();
