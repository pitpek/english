import { $, esc } from "./util.js";
import { state } from "./state.js";
import { parseEpub, renderChapter } from "./epub.js";

const INDEX_URL = new URL("../books/index.json", import.meta.url).href;
const POS_KEY = "english-reader-pos-v2";
const MIN_FONT = 16;
const MAX_FONT = 28;

let stride = 0;
let resizeObs = null;
let lastBox = "";
let lastLayoutKey = "";

function bookUrl(file) {
  if (!file || file.includes("..")) throw new Error("Некорректный файл книги");
  return new URL(file.replace(/^\/+/, ""), new URL("../books/", import.meta.url)).href;
}

function loadPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || localStorage.getItem("english-reader-pos-v1") || "{}");
    if (raw.books) return raw;
    if (raw.file) {
      return {
        fontSize: raw.fontSize || 20,
        books: { [raw.file]: { chapter: raw.chapter || 0, progress: 0 } },
      };
    }
  } catch { /* ignore */ }
  return { fontSize: 20, books: {} };
}

function savePos() {
  const r = state.reader;
  if (!r.book || !r.file) return;
  const all = loadPos();
  const pages = Math.max(1, r.pageCount || 1);
  all.fontSize = r.fontSize;
  all.books = all.books || {};
  all.books[r.file] = {
    chapter: r.chapter,
    progress: pages <= 1 ? 0 : r.page / (pages - 1),
  };
  localStorage.setItem(POS_KEY, JSON.stringify(all));
}

function revokeBlobs() {
  (state.reader.blobs || []).forEach((url) => URL.revokeObjectURL(url));
  state.reader.blobs = [];
}

function catalogItems(data) {
  const list = Array.isArray(data) ? data : data && data.books;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (typeof item === "string") return { file: item, title: "" };
    return { file: item.file || item.name || "", title: item.title || "" };
  }).filter((item) => item.file && !item.file.includes(".."));
}

async function loadCatalog() {
  const r = state.reader;
  r.loading = true;
  r.error = "";
  try {
    const res = await fetch(INDEX_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    r.catalog = catalogItems(await res.json());
  } catch {
    r.catalog = [];
    r.error = "Не удалось загрузить список книг. Нужен файл books/index.json";
  }
  r.loading = false;
  if (state.mode === "reader") renderReader();
}

async function openBook(file) {
  const r = state.reader;
  r.file = file;
  r.loading = true;
  r.error = "";
  r.book = null;
  revokeBlobs();
  renderReader();
  try {
    const res = await fetch(bookUrl(file), { cache: "no-store" });
    if (!res.ok) throw new Error("Книга не найдена");
    const book = await parseEpub(await res.arrayBuffer());
    const pos = loadPos();
    const saved = pos.books && pos.books[file];
    r.file = file;
    r.book = book;
    r.chapter = saved && Number.isInteger(saved.chapter)
      ? Math.min(Math.max(0, saved.chapter), book.chapters.length - 1)
      : 0;
    r.page = 0;
    r.restore = saved && typeof saved.progress === "number" ? saved.progress : 0;
    if (pos.fontSize) r.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, pos.fontSize));
    savePos();
  } catch (err) {
    r.error = err && err.message ? err.message : "Не удалось открыть EPUB";
  }
  r.loading = false;
  if (state.mode === "reader") renderReader();
}

function applyTransform(animate) {
  const track = $("readerTrack");
  if (!track) return;
  track.style.transition = animate ? "transform .28s ease" : "none";
  track.style.transform = `translate3d(${-state.reader.page * stride}px, 0, 0)`;
}

function updatePager() {
  const r = state.reader;
  const el = $("readerPager");
  if (el) el.textContent = `${(r.page || 0) + 1} / ${r.pageCount || 1}`;
  const atStart = r.chapter === 0 && r.page === 0;
  const atEnd = r.book && r.chapter >= r.book.chapters.length - 1 && r.page >= (r.pageCount || 1) - 1;
  const prev = $("readerPrev");
  const next = $("readerNext");
  if (prev) prev.disabled = atStart;
  if (next) next.disabled = atEnd;
}

function fitFrame() {
  const frame = $("readerFrame");
  if (!frame) return { w: 0, h: 0 };
  const nav = frame.parentElement.querySelector(".card-nav");
  const navH = nav ? nav.offsetHeight + 12 : 56;
  const top = frame.getBoundingClientRect().top;
  const h = Math.max(180, Math.floor(window.innerHeight - top - navH));
  frame.style.height = h + "px";
  return { w: frame.clientWidth, h: frame.clientHeight };
}

function overflows(box) {
  return box.scrollHeight > box.clientHeight + 1;
}

function paginateHtml(html, width, height, fontSize) {
  const measure = document.createElement("div");
  measure.className = "reader-sheet";
  measure.style.cssText = [
    "position:absolute", "left:-9999px", "top:0", "visibility:hidden",
    `width:${width}px`, `height:${height}px`, `font-size:${fontSize}px`,
  ].join(";");
  document.body.appendChild(measure);

  const source = document.createElement("div");
  source.innerHTML = html;
  const nodes = [...source.childNodes].filter((node) => {
    if (node.nodeType === 1) return true;
    return node.nodeType === 3 && node.textContent.trim();
  });

  const pages = [];
  let current = document.createElement("div");
  measure.appendChild(current);

  const pushPage = () => {
    const inner = current.innerHTML.trim();
    if (inner) pages.push(inner);
    current = document.createElement("div");
    measure.replaceChildren(current);
  };

  const fillParagraph = (p) => {
    const words = (p.textContent || "").split(/(\s+)/);
    let dest = p.cloneNode(false);
    current.appendChild(dest);
    let ok = "";
    for (const part of words) {
      dest.textContent = ok + part;
      if (overflows(measure) && ok.trim()) {
        dest.textContent = ok;
        pushPage();
        dest = dest.cloneNode(false);
        current.appendChild(dest);
        ok = part;
        dest.textContent = ok;
      } else {
        ok += part;
      }
    }
  };

  for (const node of nodes) {
    const clone = node.cloneNode(true);
    current.appendChild(clone);
    if (!overflows(measure)) continue;
    current.removeChild(clone);
    if (current.childNodes.length) pushPage();
    current.appendChild(clone);
    if (!overflows(measure)) continue;
    current.removeChild(clone);
    if (clone.nodeName === "P") fillParagraph(clone);
    else {
      current.appendChild(clone);
      pushPage();
    }
  }
  if (current.innerHTML.trim()) pages.push(current.innerHTML.trim());
  measure.remove();
  return pages.length ? pages : ["<p></p>"];
}

function fillTrack(pages, width, height, fontSize) {
  const track = $("readerTrack");
  if (!track) return;
  stride = width;
  track.style.height = height + "px";
  track.innerHTML = pages.map((html) => (
    `<div class="reader-sheet" style="width:${width}px;height:${height}px;font-size:${fontSize}px">${html}</div>`
  )).join("");
}

function layoutPages(restore) {
  const r = state.reader;
  const frame = $("readerFrame");
  const track = $("readerTrack");
  if (!frame || !track || !r.book || !r.chapterHtml) return;
  const { w, h } = fitFrame();
  if (w < 40 || h < 40) return;
  const key = `${w}x${h}x${r.fontSize}x${r.chapter}`;
  const used = restore !== undefined ? restore : 0;
  if (key !== lastLayoutKey) {
    lastLayoutKey = key;
    const pages = paginateHtml(r.chapterHtml, w, h, r.fontSize);
    fillTrack(pages, w, h, r.fontSize);
    r.pageCount = pages.length;
  }
  if (used === "end") r.page = r.pageCount - 1;
  else if (typeof used === "number") r.page = Math.round(used * Math.max(0, r.pageCount - 1));
  r.page = Math.min(Math.max(0, r.page || 0), r.pageCount - 1);
  r.restore = undefined;
  applyTransform(false);
  updatePager();
  savePos();
}

function go(delta) {
  const r = state.reader;
  if (!r.book) return;
  const next = (r.page || 0) + delta;
  if (next >= 0 && next < (r.pageCount || 1)) {
    r.page = next;
    applyTransform(true);
    updatePager();
    savePos();
    return;
  }
  if (delta > 0 && r.chapter < r.book.chapters.length - 1) {
    r.chapter += 1;
    r.page = 0;
    r.restore = 0;
    renderReader();
    return;
  }
  if (delta < 0 && r.chapter > 0) {
    r.chapter -= 1;
    r.restore = "end";
    renderReader();
    return;
  }
  applyTransform(true);
}

function setChapter(next) {
  const r = state.reader;
  if (!r.book) return;
  r.chapter = Math.min(Math.max(0, next), r.book.chapters.length - 1);
  r.page = 0;
  r.restore = 0;
  savePos();
  renderReader();
}

function changeFont(delta) {
  const r = state.reader;
  r.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, r.fontSize + delta));
  const progress = r.pageCount > 1 ? r.page / (r.pageCount - 1) : 0;
  lastLayoutKey = "";
  requestAnimationFrame(() => layoutPages(progress));
}

function bindSwipe() {
  const frame = $("readerFrame");
  if (!frame) return;
  let pid = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let axis = null;

  frame.onpointerdown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("button, select")) return;
    pid = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    axis = null;
    try { frame.setPointerCapture(pid); } catch { /* ignore */ }
  };
  frame.onpointermove = (e) => {
    if (pid == null || e.pointerId !== pid) return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    }
    if (axis !== "x") return;
    e.preventDefault();
    dx = mx;
    const track = $("readerTrack");
    if (!track) return;
    track.style.transition = "none";
    track.style.transform = `translate3d(${-state.reader.page * stride + dx}px, 0, 0)`;
  };
  const end = (e) => {
    if (pid == null || (e && e.pointerId !== pid)) return;
    pid = null;
    if (axis === "x") {
      if (dx < -45) go(1);
      else if (dx > 45) go(-1);
      else applyTransform(true);
    } else if (axis == null && e && e.type === "pointerup") {
      const rect = frame.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      if (rel < 0.28) go(-1);
      else if (rel > 0.72) go(1);
    }
    axis = null;
    dx = 0;
  };
  frame.onpointerup = end;
  frame.onpointercancel = end;
}

function watchFrame() {
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  const frame = $("readerFrame");
  if (!frame || typeof ResizeObserver !== "function") return;
  lastBox = "";
  resizeObs = new ResizeObserver(() => {
    const box = frame.clientWidth + "x" + frame.clientHeight;
    if (box === lastBox) return;
    lastBox = box;
    const r = state.reader;
    const hint = r.restore !== undefined
      ? r.restore
      : (r.pageCount > 1 ? r.page / (r.pageCount - 1) : 0);
    layoutPages(hint);
  });
  resizeObs.observe(frame);
}

function bindReader() {
  const r = state.reader;
  const back = $("readerBack");
  if (back) {
    back.onclick = () => {
      savePos();
      if (resizeObs) resizeObs.disconnect();
      revokeBlobs();
      r.book = null;
      r.file = "";
      renderReader();
    };
  }
  const list = $("bookList");
  if (list) {
    list.querySelectorAll("[data-file]").forEach((btn) => {
      btn.onclick = () => openBook(btn.dataset.file);
    });
  }
  const select = $("readerChapters");
  if (select) select.onchange = () => setChapter(Number(select.value));
  const minus = $("readerMinus");
  const plus = $("readerPlus");
  if (minus) minus.onclick = () => changeFont(-2);
  if (plus) plus.onclick = () => changeFont(2);
  const prev = $("readerPrev");
  const next = $("readerNext");
  if (prev) prev.onclick = () => go(-1);
  if (next) next.onclick = () => go(1);
  bindSwipe();
  watchFrame();
}

export function readerStep(delta) {
  if (state.mode !== "reader" || !state.reader.book) return;
  go(delta);
}

export function renderReader() {
  const r = state.reader;
  document.body.classList.toggle("mode-reader", true);
  document.body.classList.toggle("mode-reading", !!r.book);
  if (r.catalog == null) {
    $("stage").innerHTML = `<div class="empty">Загрузка списка книг…</div>`;
    if (!r.loading) void loadCatalog();
    return;
  }
  if (r.loading && !r.book) {
    $("stage").innerHTML = `<div class="empty">${r.file ? "Открываю книгу…" : "Загрузка…"}</div>`;
    return;
  }
  if (!r.book) {
    if (resizeObs) resizeObs.disconnect();
    const rows = r.catalog.map((book) => `
      <button class="book-item" type="button" data-file="${esc(book.file)}">
        <b>${esc(book.title || book.file.replace(/\.epub$/i, ""))}</b>
        <span>${esc(book.file)}</span>
      </button>
    `).join("");
    $("stage").innerHTML = `
      <div class="reader">
        <div class="session">Читалка</div>
        ${r.error ? `<div class="feedback" style="color:var(--bad)">${esc(r.error)}</div>` : ""}
        ${rows ? `<div class="book-list" id="bookList">${rows}</div>` : `
          <div class="empty">Пока нет книг. Положи файлы .epub в папку <b>books</b> и добавь их в <b>books/index.json</b>.</div>
        `}
      </div>
    `;
    bindReader();
    return;
  }

  revokeBlobs();
  const page = renderChapter(r.book, r.chapter);
  r.blobs = page.blobs;
  r.chapterHtml = page.html;
  lastLayoutKey = "";
  if (page.title && !r.book.chapters[r.chapter].title) {
    r.book.chapters[r.chapter].title = page.title;
  }
  const options = r.book.chapters.map((ch, i) => {
    const label = ch.title || `Глава ${i + 1}`;
    return `<option value="${i}" ${i === r.chapter ? "selected" : ""}>${esc(`${i + 1}. ${label}`)}</option>`;
  }).join("");

  $("stage").innerHTML = `
    <div class="reader">
      <div class="reader-bar">
        <button class="ghost" id="readerBack" type="button">Книги</button>
        <select id="readerChapters">${options}</select>
        <button class="ghost" id="readerMinus" type="button">A−</button>
        <button class="ghost" id="readerPlus" type="button">A+</button>
      </div>
      <div class="reader-meta">
        ${esc(r.book.title)}${r.book.author ? " · " + esc(r.book.author) : ""}
        · <span id="readerPager">1 / 1</span>
      </div>
      <div class="reader-frame" id="readerFrame">
        <div class="reader-track" id="readerTrack"></div>
      </div>
      <div class="card-nav">
        <button class="ghost" id="readerPrev" type="button">←</button>
        <button class="ghost" id="readerNext" type="button">→</button>
      </div>
    </div>
  `;
  bindReader();
  requestAnimationFrame(() => layoutPages(r.restore));
}
