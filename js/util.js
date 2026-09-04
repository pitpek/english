export function $(id) {
  return document.getElementById(id);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[а-яё]/i.test(text) ? "ru-RU" : "en-US";
  speechSynthesis.speak(u);
}

export function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[()[\].,!?;:«»"'`/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
