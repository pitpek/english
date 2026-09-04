import { $, shuffle, speak } from "./util.js";
import { parseDictionary } from "./dictionary.js";
import { DICT_NAME } from "./storage.js";
import { state, current, resetProgress, setOnProgressChange } from "./state.js";
import {
  applyFilters,
  setGroup,
  setWords,
  render,
  flip,
  step,
  mark,
  toggleStar,
  updateProgress,
  setFiltersOpen,
  closeInstallModal,
  showInstallHelp,
} from "./ui.js";
import { readerStep } from "./reader.js";

setOnProgressChange(updateProgress);

async function boot() {
  try {
    const res = await fetch(DICT_NAME, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const words = parseDictionary(await res.text(), DICT_NAME);
    if (!words.length) throw new Error("empty");
    state.source = "words.json";
    setWords(words);
  } catch {
    $("meta").textContent = "Не удалось загрузить словарь";
    $("stage").innerHTML = `<div class="empty">Открой страницу через локальный сервер (http://…) или загрузи файл JSON вручную.</div>`;
  }
}

document.querySelectorAll(".mode").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".mode").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    state.learn = null;
    state.write = null;
    state.match = null;
    state.learnN = 0;
    render();
  };
});

$("dirBtn").onclick = () => {
  state.dir = state.dir === "en-ru" ? "ru-en" : "en-ru";
  $("dirBtn").textContent = state.dir === "en-ru" ? "EN → RU" : "RU → EN";
  $("dirBtn").classList.toggle("active", true);
  state.learn = null;
  state.write = null;
  render();
};

$("shuffleBtn").onclick = () => {
  state.deck = shuffle(state.filtered);
  state.index = 0;
  state.flipped = false;
  state.learn = null;
  state.write = null;
  state.match = null;
  render();
};

$("speakBtn").onclick = () => {
  const w = current() || (state.learn && state.learn.card) || (state.write && state.write.card);
  if (w) speak(w.word);
};

["onlyStar", "onlyHard", "onlyNew"].forEach((id) => {
  $(id).onchange = applyFilters;
});

$("resetProgress").onclick = () => {
  if (!confirm("Сбросить прогресс и звёзды?")) return;
  resetProgress();
  applyFilters();
};

$("dictFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const words = parseDictionary(await file.text(), file.name);
    if (!words.length) throw new Error("empty");
    state.source = file.name;
    setWords(words);
  } catch {
    $("meta").textContent = "Не удалось прочитать словарь";
    $("stage").innerHTML = `<div class="empty">Нужен JSON со словами (или старый .md).</div>`;
  }
};

$("levelsAll").onclick = () => setGroup("levels", "all");
$("levelsNone").onclick = () => setGroup("levels", "none");
$("catsAll").onclick = () => setGroup("cats", "all");
$("catsNone").onclick = () => setGroup("cats", "none");

$("filterToggle").onclick = () => {
  setFiltersOpen(!$("sidebar").classList.contains("open"));
};
$("backdrop").onclick = () => setFiltersOpen(false);
$("filtersDone").onclick = () => setFiltersOpen(false);

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  showInstallHelp();
}

$("installBtn").onclick = installApp;
$("installBtnMobile").onclick = installApp;
$("installClose").onclick = closeInstallModal;
$("installModal").addEventListener("click", (e) => {
  if (e.target.id === "installModal") closeInstallModal();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setFiltersOpen(false);
    closeInstallModal();
  }
  if (e.target.matches("input, textarea, select")) return;
  if (state.mode === "cards") {
    if (e.code === "Space") {
      e.preventDefault();
      flip();
    }
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "1") mark(false);
    if (e.key === "2") mark(true);
    if (e.key === "s") toggleStar();
  }
  if (state.mode === "reader") {
    if (e.key === "ArrowRight") readerStep(1);
    if (e.key === "ArrowLeft") readerStep(-1);
  }
  if (e.key === "p") {
    const w = current() || (state.learn && state.learn.card);
    if (w) speak(w.word);
  }
});

boot();
