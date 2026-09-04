import { loadProgress, saveProgress, wordId } from "./storage.js";

export const state = {
  all: [],
  filtered: [],
  mode: "cards",
  dir: "en-ru",
  index: 0,
  flipped: false,
  deck: [],
  progress: loadProgress(),
  selectedLevels: new Set(),
  selectedCats: new Set(),
  learn: null,
  learnN: 0,
  write: null,
  match: null,
  reader: {
    catalog: null,
    loading: false,
    error: "",
    file: "",
    book: null,
    chapter: 0,
    fontSize: 20,
    blobs: [],
  },
  source: "",
};

export let onProgressChange = () => {};

export function setOnProgressChange(fn) {
  onProgressChange = fn;
}

export function stats(w) {
  return state.progress[wordId(w)] || {
    known: 0,
    seen: 0,
    correct: 0,
    wrong: 0,
    starred: false,
  };
}

export function patch(w, extra) {
  const id = wordId(w);
  state.progress[id] = { ...stats(w), ...extra };
  saveProgress(state.progress);
  onProgressChange();
}

export function record(w, ok) {
  const s = stats(w);
  patch(w, {
    seen: s.seen + 1,
    correct: s.correct + (ok ? 1 : 0),
    wrong: s.wrong + (ok ? 0 : 1),
    known: ok ? Math.min(3, s.known + 1) : Math.max(0, s.known - 1),
  });
}

export function knownCount() {
  return state.all.filter((w) => stats(w).known >= 2).length;
}

export function resetProgress() {
  state.progress = {};
  saveProgress(state.progress);
  onProgressChange();
}

export function front(w) {
  return state.dir === "en-ru" ? w.word : w.translation;
}

export function back(w) {
  return state.dir === "en-ru" ? w.translation : w.word;
}

export function current() {
  return state.deck[state.index];
}

export function pickCard() {
  if (!state.filtered.length) return null;
  const weighted = [];
  state.filtered.forEach((w) => {
    const s = stats(w);
    const weight = s.known >= 2 ? 1 : 3 + s.wrong;
    for (let i = 0; i < weight; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}
