/* Boot the real application against a stub DOM, then drive it.
 *
 * Run with `node --test tests/boot.test.mjs`.
 *
 * The unit tests cover field.js, which is pure arithmetic. This covers the part
 * that is not: main.js resolves some forty elements by id at module scope,
 * wires two dozen listeners, and calls into field.js and nebula.js from a
 * requestAnimationFrame loop. None of that is exercised by testing the maths,
 * and all of it breaks in the same way — a renamed id resolves to null and the
 * failure arrives much later, inside a handler, as a TypeError nobody sees
 * until they click the thing.
 *
 * So: a canvas that records nothing, a DOM that knows only the ids the real
 * markup defines, and then the interactions a visitor actually performs. It
 * proves the app boots, reads its dataset, and survives being used. It cannot
 * prove anything about how it *looks* — nothing here draws — and that limit is
 * the reason the layout work still has to be seen in a browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/* A 2D context that answers every call and remembers nothing. Canvas is the
   one browser API this code leans on hard, and faking it faithfully would be a
   project of its own — but nothing here asserts on pixels, so a proxy that
   never throws is exactly as useful and a great deal shorter. */
const ctx2d = new Proxy({}, {
  get: (_t, k) => {
    if (k === "canvas") return { width: 1200, height: 700 };
    if (k === "createPattern") return () => ({});
    if (k === "measureText") return () => ({ width: 10 });
    if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
    return typeof k === "string" ? () => {} : undefined;
  },
  set: () => true,
});

function makeEl(id = "", tag = "div") {
  const listeners = new Map();
  const el = {
    id, tagName: tag.toUpperCase(), listeners,
    style: new Proxy({}, { get: () => "", set: () => true }),
    dataset: {}, className: "", textContent: "", innerHTML: "",
    value: "", href: "", src: "", alt: "", title: "", hidden: false,
    width: 0, height: 0, clientWidth: 1200, clientHeight: 26, children: [],
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      toggle(c, on) { on ?? !this._set.has(c) ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 96, right: 1200, bottom: 96 }),
    getContext: () => ctx2d,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    scrollIntoView() {}, focus() {}, blur() {}, select() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  return el;
}

/** Boot the app once and hand back the handles a test needs to drive it. */
async function boot() {
  const byId = new Map();
  const html = readFileSync(join(APP, "index.html"), "utf8");
  /* Only the ids the real markup defines, so a lookup for something that is
     not there comes back null exactly as it would in a browser — and with the
     `hidden` attribute honoured, because several panels start closed and code
     that toggles one reads its current state to decide which way to go. A stub
     that reports every panel as open makes "open the tables" close them. */
  for (const tag of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = makeEl(tag[1]);
    node.hidden = /\shidden(\s|>|=)/.test(tag[0]);
    byId.set(tag[1], node);
  }

  const windowListeners = new Map();
  globalThis.document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => makeEl("", tag),
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    body: { appendChild() {} },
    fonts: { ready: Promise.resolve() },
    addEventListener() {},
    execCommand: () => true,
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    devicePixelRatio: 2,
  };
  globalThis.location = { search: "", pathname: "/", hash: "", href: "/" };
  globalThis.history = { replaceState() {} };
  // Node defines navigator as a getter-only global, so it cannot be assigned.
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true, writable: true,
  });
  globalThis.performance = { now: () => Date.now() };
  let raf = null;
  globalThis.requestAnimationFrame = (fn) => { raf = fn; return 1; };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.Image = class {
    constructor() { this.complete = true; this.naturalWidth = 640; this.naturalHeight = 500; }
    decode() { return Promise.resolve(); }
  };
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => JSON.parse(readFileSync(join(APP, url), "utf8")),
  });

  // Cache-busted, so a second boot in the same process is a fresh module.
  await import(`${pathToFileURL(join(APP, "js", "main.js")).href}?t=${Date.now()}`);
  await new Promise((r) => setTimeout(r, 700));   // init() awaits a 460ms compose beat

  const fire = (id, type, event = {}) =>
    byId.get(id)?.listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...event });
  return {
    byId, fire, windowListeners,
    frame: (t = performance.now()) => raf?.(t),
    click: (id) => fire(id, "click", { target: byId.get(id) }),
    // Some nodes are written as text and some as markup; a test asking "what
    // does this say" should not have to know which.
    text: (id) => {
      const node = byId.get(id);
      return node ? (node.textContent || node.innerHTML || "") : null;
    },
    scope: (key) => fire("scope", "click", {
      target: { closest: (sel) => (sel === "[data-scope]" ? { dataset: { scope: key } } : null) },
    }),
  };
}

test("the app boots and reads its dataset", async () => {
  const app = await boot();
  const log = app.text("bootLog");
  assert.ok(!/^!/m.test(log), `boot reported an error:\n${log}`);
  assert.match(log, /paintings/, "the boot log should name the dataset size");
  // The readout is painted inside the frame loop, not at boot, so it is only
  // meaningful once a frame has run.
  app.frame();
  assert.match(app.text("statWorks"), /^[\d,]+$/);
  assert.match(app.text("statSpan"), /^\d{4}–\d{4}$/);
});

test("a frame can be drawn", async () => {
  const app = await boot();
  app.frame();
  assert.match(app.text("axes"), /HORIZONTAL/);
});

test("every control survives being used", async () => {
  const app = await boot();
  const steps = [
    ["layout", () => app.click("btnLayout")],
    ["timelapse on", () => app.click("btnTimelapse")],
    ["frame while playing", () => app.frame(performance.now() + 16)],
    ["play/pause", () => app.click("btnPlay")],
    ["school filter", () => {
      app.byId.get("natFilter").value = "3";
      app.fire("natFilter", "change");
    }],
    ["search", () => {
      app.byId.get("search").value = "rembrandt";
      app.fire("search", "input");
    }],
    ["frame after search", () => app.frame(performance.now() + 32)],
    ["enter walks the matches", () =>
      app.fire("search", "keydown", { key: "Enter", shiftKey: false })],
    ["colours like this one", () => app.click("btnNear")],
    ["frame after near", () => app.frame(performance.now() + 48)],
    ["about", () => { app.click("btnInfo"); app.click("aboutClose"); }],
    ["close detail", () => app.click("detailClose")],
    ["keyboard arrow", () =>
      app.windowListeners.get("keydown")?.({
        key: "ArrowRight", target: app.byId.get("stage"), preventDefault() {},
      })],
  ];
  for (const [name, run] of steps) {
    assert.doesNotThrow(run, `"${name}" threw`);
  }
});

test("the scope line answers every one of its chips", async () => {
  const app = await boot();
  // Narrow along every axis at once, which is the state the scope line exists
  // for: five things true together and nothing else on screen saying so.
  app.click("btnTimelapse");
  app.byId.get("natFilter").value = "3";
  app.fire("natFilter", "change");
  app.byId.get("search").value = "rembrandt";
  app.fire("search", "input");
  app.frame();   // the scope line is painted by the loop, not by the setters

  const scope = app.text("scope");
  assert.ok(scope.includes("MOVING WINDOW"), "the year window must be named");
  assert.ok(scope.includes("rembrandt"), "the query must be named");
  assert.ok(scope.includes("CLEAR ALL"), "a narrowed view must offer to clear");

  for (const chip of ["layout", "time", "nat", "query", "near", "copy", "all"]) {
    assert.doesNotThrow(() => app.scope(chip), `chip "${chip}" threw`);
  }
  app.frame();
  // Everything lifted: the line goes back to stating the size of the whole.
  assert.ok(app.text("scope").includes("PAINTINGS"),
    "with nothing narrowed the line should state the collection");
});

test("the tables open, switch, and lead back into the field", async () => {
  const app = await boot();
  app.click("btnTables");
  assert.equal(app.byId.get("tables").hidden, false, "the panel should open");

  const high = app.text("tableHigh");
  assert.ok(high.includes("WORKS"), "rows should state how many works they rest on");
  assert.ok(high.includes("data-key"), "painter rows should lead somewhere");

  // Switching measure and grouping must not throw and must rewrite the tables.
  for (const [id, sel, key] of [
    ["tableMeasure", "[data-measure]", "light"],
    ["tableBy", "[data-by]", "school"],
    ["tableBy", "[data-by]", "source"],
  ]) {
    app.fire(id, "click", {
      target: { closest: (s) => (s === sel ? { dataset: { measure: key, by: key } } : null) },
    });
  }
  // A museum leads nowhere -- the field has no filter for which collection a
  // work came from -- so those rows must not pretend to be pressable.
  assert.ok(!app.text("tableHigh").includes("data-key"),
    "museum rows should not be buttons");

  // Back to painters, then walk into the field through a row.
  app.fire("tableBy", "click", {
    target: { closest: (s) => (s === "[data-by]" ? { dataset: { by: "artist" } } : null) },
  });
  app.fire("tables", "click", {
    target: { closest: (s) => (s === "li [data-key]" ? { dataset: { key: "Claude Monet" } } : null) },
  });
  assert.equal(app.byId.get("tables").hidden, true, "the panel should close behind you");
  app.frame();
  assert.ok(app.text("scope").includes("Claude Monet"),
    "the field should now be narrowed to the row that was pressed");
});

test("the detail panel places a work and offers its siblings", async () => {
  const app = await boot();
  // Reach a painting the way a visitor does, through a search result rather
  // than by inventing a particle index: Monet has sixty-odd works here, so the
  // sibling strip is guaranteed to have something in it.
  app.byId.get("search").value = "monet";
  app.fire("search", "input");
  app.frame();
  app.fire("search", "keydown", { key: "Enter", shiftKey: false });
  await new Promise((r) => setTimeout(r, 250));   // fillDetail may await a decode

  assert.equal(app.byId.get("detail").hidden, false, "a work should be open");

  const era = app.byId.get("detailEra");
  assert.equal(era.hidden, false, "a 19th-century work has a thick enough era to quote");
  assert.match(era.innerHTML, /OF ITS TIME/, "the placement should be said in words");
  assert.match(era.innerHTML, /AGAINST [\d,]+ WORKS OF \d{4}–\d{4}/,
    "the era should state what it was measured against");

  const kin = app.byId.get("detailKin");
  assert.equal(kin.hidden, false, "Monet should have siblings");
  assert.match(app.text("detailKinLabel"), /MORE BY/);
  assert.match(app.byId.get("detailKinList").innerHTML, /data-kin="\d+"/,
    "sibling thumbnails should be pressable");

  // The colour button names the colour it would actually ask about.
  assert.match(app.byId.get("btnNear").innerHTML, /#[0-9A-F]{6}/i,
    "the button should name its colour, not say 'this one'");

  // Pressing a sibling opens that painting in the same panel.
  const first = app.byId.get("detailKinList").innerHTML.match(/data-kin="(\d+)"/)[1];
  assert.doesNotThrow(() => app.fire("detail", "click", {
    target: { closest: (s) => (s === "[data-kin]" ? { dataset: { kin: first } } : null) },
  }));
});

test("the opening hint is spent by the first touch of the field", async () => {
  const app = await boot();
  const hint = app.byId.get("hint");
  assert.ok(!hint.classList.contains("is-spent"), "the hint starts visible");
  app.fire("stage", "pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  assert.ok(hint.classList.contains("is-spent"), "it goes once you have used the field");
});

test("asking one question puts the other away, and says so", async () => {
  const app = await boot();
  app.byId.get("search").value = "vermeer";
  app.fire("search", "input");
  app.frame();
  assert.ok(app.text("scope").includes("vermeer"), "the query should be named");

  app.click("btnNear");   // no selection yet: must not throw, must not lie
  app.frame();
  assert.ok(app.text("scope").includes("vermeer"),
    "a colour question with nothing selected must not disturb the text one");
});
