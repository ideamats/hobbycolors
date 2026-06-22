"use strict";

// Browse/search UI for the hobby color libraries. Reads the same JSON the ColorMixer app consumes
// (data/manifest.json + data/<id>.json) and filters entirely client-side — no build step.

const DATA = "data/";
const TYPE_LABELS = {
  Generic: "Generic",
  Enamel: "Enamel",
  Acrylic: "Acrylic",
  Lacquer: "Lacquer",
  ArtOil: "Oil",
  ArtAcrylic: "Acrylic (Artist)",
};

const els = {
  library: document.getElementById("library"),
  type: document.getElementById("type"),
  search: document.getElementById("search"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
};

const state = {
  manifest: null,
  cache: new Map(), // id -> normalized color list
};

init();

async function init() {
  try {
    state.manifest = await fetchJson(DATA + "manifest.json");
  } catch (e) {
    els.status.textContent = "Could not load color data: " + e.message;
    return;
  }

  const all = document.createElement("option");
  all.value = "__all__";
  all.textContent = "All libraries";
  els.library.appendChild(all);
  for (const lib of state.manifest.libraries) {
    const opt = document.createElement("option");
    opt.value = lib.id;
    opt.textContent = lib.title + " (" + lib.colorCount + ")";
    els.library.appendChild(opt);
  }

  els.library.value = state.manifest.libraries[0].id;
  els.library.addEventListener("change", onLibraryChange);
  els.type.addEventListener("change", render);
  els.search.addEventListener("input", debounce(render, 120));

  await onLibraryChange();
}

async function onLibraryChange() {
  els.status.textContent = "Loading…";
  try {
    const colors = await currentColors();
    rebuildTypeFilter(colors);
    render();
  } catch (e) {
    els.status.textContent = "Could not load library: " + e.message;
    els.results.innerHTML = "";
  }
}

// Loads (and caches) the normalized color list for the current selection.
async function currentColors() {
  const id = els.library.value;
  if (id === "__all__") {
    const lists = await Promise.all(state.manifest.libraries.map((l) => loadLibrary(l.id)));
    return lists.flat();
  }
  return loadLibrary(id);
}

async function loadLibrary(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const entry = state.manifest.libraries.find((l) => l.id === id);
  const data = await fetchJson(DATA + entry.file);
  const colors = normalize(data, entry.title);
  state.cache.set(id, colors);
  return colors;
}

// Applies the library/group defaults so each color is self-contained, mirroring RemoteColorLibrary.
function normalize(data, libraryTitle) {
  const out = [];
  for (const group of data.groups || []) {
    const groupType = group.type || "Generic";
    for (const c of group.colors || []) {
      out.push({
        code: c.code,
        name: c.name,
        rgb: (c.rgb || "000000").toUpperCase(),
        brand: c.brand || data.brand || "",
        type: c.type || groupType,
        group: group.name,
        library: libraryTitle,
      });
    }
  }
  return out;
}

function rebuildTypeFilter(colors) {
  const present = [...new Set(colors.map((c) => c.type))].sort();
  const prev = els.type.value;
  els.type.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = "All finishes";
  els.type.appendChild(any);
  for (const t of present) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = TYPE_LABELS[t] || t;
    els.type.appendChild(opt);
  }
  els.type.value = present.includes(prev) ? prev : "";
}

async function render() {
  const colors = await currentColors();
  const term = els.search.value.trim().toLowerCase();
  const typeFilter = els.type.value;
  const groupByLibrary = els.library.value === "__all__";

  const filtered = colors.filter((c) => {
    if (typeFilter && c.type !== typeFilter) return false;
    if (!term) return true;
    return (
      c.code.toLowerCase().includes(term) ||
      c.name.toLowerCase().includes(term) ||
      c.brand.toLowerCase().includes(term)
    );
  });

  els.status.textContent =
    filtered.length + " color" + (filtered.length === 1 ? "" : "s") +
    (term ? ' for "' + els.search.value.trim() + '"' : "");

  els.results.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matching colors.";
    els.results.appendChild(empty);
    return;
  }

  const groups = new Map();
  for (const c of filtered) {
    const key = groupByLibrary ? c.library : c.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const frag = document.createDocumentFragment();
  for (const [name, list] of groups) {
    frag.appendChild(renderGroup(name, list));
  }
  els.results.appendChild(frag);
}

function renderGroup(name, colors) {
  const section = document.createElement("section");
  section.className = "group";

  const h2 = document.createElement("h2");
  h2.textContent = name || "Colors";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = colors.length;
  h2.appendChild(count);
  section.appendChild(h2);

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const c of colors) grid.appendChild(renderSwatch(c));
  section.appendChild(grid);
  return section;
}

function renderSwatch(c) {
  const div = document.createElement("div");
  div.className = "swatch";
  div.style.background = "#" + c.rgb;
  div.style.color = contrast(c.rgb);
  div.title = c.brand + " " + c.code + " — " + c.name;
  div.innerHTML =
    '<div><div class="code"></div><div class="name"></div></div>' +
    '<div class="meta"></div><div class="hex">#' + c.rgb + "</div>";
  div.querySelector(".code").textContent = c.code;
  div.querySelector(".name").textContent = c.name;
  div.querySelector(".meta").textContent =
    (c.brand ? c.brand + " · " : "") + (TYPE_LABELS[c.type] || c.type);
  return div;
}

// Choose black/white text for legibility (sRGB relative luminance).
function contrast(hex) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#101216" : "#ffffff";
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
