import { $, esc } from "./util.js";
import { state } from "./state.js";
import { parseEpub, renderChapter } from "./epub.js";

const INDEX_URL = new URL("../books/index.json", import.meta.url).href;
const POS_KEY = "english-reader-pos-v1";
const MIN_FONT = 16;
const MAX_FONT = 28;

function bookUrl(file) {
  if (!file || file.includes("..")) throw new Error("Некорректный файл книги");
  return new URL(file.replace(/^\/+/, ""), new URL("../books/", import.meta.url)).href;
}

function loadPos() {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePos() {
  const r = state.reader;
  if (!r.book) return;
  localStorage.setItem(POS_KEY, JSON.stringify({
    file: r.file,
    chapter: r.chapter,
    fontSize: r.fontSize,
  }));
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
    r.file = file;
    r.book = book;
    r.chapter = pos.file === file && Number.isInteger(pos.chapter)
      ? Math.min(Math.max(0, pos.chapter), book.chapters.length - 1)
      : 0;
    if (pos.fontSize) r.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, pos.fontSize));
    savePos();
  } catch (err) {
    r.error = err && err.message ? err.message : "Не удалось открыть EPUB";
  }
  r.loading = false;
  if (state.mode === "reader") renderReader();
}

function setChapter(next) {
  const r = state.reader;
  if (!r.book) return;
  r.chapter = Math.min(Math.max(0, next), r.book.chapters.length - 1);
  savePos();
  renderReader();
  $("readerPage")?.scrollIntoView({ block: "start" });
}

function bindReader() {
  const r = state.reader;
  const back = $("readerBack");
  if (back) {
    back.onclick = () => {
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
  if (select) {
    select.onchange = () => setChapter(Number(select.value));
  }
  const minus = $("readerMinus");
  const plus = $("readerPlus");
  if (minus) {
    minus.onclick = () => {
      r.fontSize = Math.max(MIN_FONT, r.fontSize - 2);
      savePos();
      renderReader();
    };
  }
  if (plus) {
    plus.onclick = () => {
      r.fontSize = Math.min(MAX_FONT, r.fontSize + 2);
      savePos();
      renderReader();
    };
  }
  const prev = $("readerPrev");
  const next = $("readerNext");
  if (prev) prev.onclick = () => setChapter(r.chapter - 1);
  if (next) next.onclick = () => setChapter(r.chapter + 1);
}

export function readerStep(delta) {
  if (state.mode !== "reader" || !state.reader.book) return;
  setChapter(state.reader.chapter + delta);
}

export function renderReader() {
  const r = state.reader;
  document.body.classList.toggle("mode-reader", true);
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
      <div class="reader-meta">${esc(r.book.title)}${r.book.author ? " · " + esc(r.book.author) : ""}</div>
      <article class="reader-page" id="readerPage" style="font-size:${r.fontSize}px">${page.html}</article>
      <div class="card-nav">
        <button class="ghost" id="readerPrev" type="button" ${r.chapter === 0 ? "disabled" : ""}>← Глава</button>
        <button class="ghost" id="readerNext" type="button" ${r.chapter >= r.book.chapters.length - 1 ? "disabled" : ""}>Глава →</button>
      </div>
    </div>
  `;
  bindReader();
}
