export const STORE_KEY = "english-quizlet-progress-v1";
export const DICT_NAME = new URL("../data/words.json", import.meta.url).href;

export function wordId(w) {
  return [w.level, w.category, w.word].join("|");
}

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProgress(progress) {
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));
}
