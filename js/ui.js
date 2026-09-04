import { $, shuffle, esc, normalize } from "./util.js";
import { wordId } from "./storage.js";
import {
  state,
  stats,
  patch,
  record,
  knownCount,
  front,
  back,
  current,
  pickCard,
} from "./state.js";
import { renderReader } from "./reader.js";

export function updateProgress() {
  const total = state.all.length || 1;
  const known = knownCount();
  $("bar").style.width = (known / total) * 100 + "%";
  $("progressText").textContent =
    `${known} выучено · ${state.filtered.length} в текущем наборе`;
}

export function updateFilterToggle() {
  const btn = $("filterToggle");
  if (!btn) return;
  const lAll = new Set(state.all.map((w) => w.level)).size;
  const cAll = new Set(state.all.map((w) => w.category)).size;
  btn.textContent = "Фильтры";
  btn.title = `${state.selectedLevels.size}/${lAll} · ${state.selectedCats.size}/${cAll}`;
}

export function applyFilters() {
  const onlyStar = $("onlyStar").checked;
  const onlyHard = $("onlyHard").checked;
  const onlyNew = $("onlyNew").checked;
  state.filtered = state.all.filter((w) => {
    if (!state.selectedLevels.has(w.level)) return false;
    if (!state.selectedCats.has(w.category)) return false;
    const s = stats(w);
    if (onlyStar && !s.starred) return false;
    if (onlyHard && !(s.wrong > s.correct)) return false;
    if (onlyNew && s.known >= 2) return false;
    return true;
  });
  state.deck = state.filtered.slice();
  state.index = 0;
  state.flipped = false;
  state.learn = null;
  state.write = null;
  state.match = null;
  updateProgress();
  updateFilterToggle();
  render();
}

export function setGroup(kind, mode, onlyKey) {
  const keys = [...new Set(state.all.map((w) => (kind === "levels" ? w.level : w.category)))];
  const set = kind === "levels" ? state.selectedLevels : state.selectedCats;
  set.clear();
  if (mode === "all") keys.forEach((k) => set.add(k));
  else if (mode === "one" && onlyKey) set.add(onlyKey);
  const box = $(kind === "levels" ? "levels" : "cats");
  box.querySelectorAll("label.check").forEach((lab) => {
    const input = lab.querySelector("input");
    const key = lab.dataset.key;
    input.checked = set.has(key);
  });
  applyFilters();
}

export function buildFilters() {
  const levels = [...new Set(state.all.map((w) => w.level))];
  const cats = [...new Set(state.all.map((w) => w.category))];
  state.selectedLevels = new Set(levels);
  state.selectedCats = new Set(cats);
  const lvlBox = $("levels");
  const catBox = $("cats");
  lvlBox.innerHTML = "";
  catBox.innerHTML = "";
  levels.forEach((level) => {
    const n = state.all.filter((w) => w.level === level).length;
    lvlBox.appendChild(makeCheck("levels", level, n, true));
  });
  cats.forEach((cat) => {
    const n = state.all.filter((w) => w.category === cat).length;
    catBox.appendChild(makeCheck("cats", cat, n, true));
  });
}

function makeCheck(kind, key, n, checked) {
  const set = kind === "levels" ? state.selectedLevels : state.selectedCats;
  const el = document.createElement("label");
  el.className = "check";
  el.dataset.key = key;
  el.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}><span>${esc(key)}</span>`;
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "count-pill";
  pill.title = "Оставить только это";
  pill.textContent = n;
  pill.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setGroup(kind, "one", key);
  });
  el.appendChild(pill);
  el.querySelector("input").addEventListener("change", (e) => {
    if (e.target.checked) set.add(key);
    else set.delete(key);
    applyFilters();
  });
  return el;
}

export function setWords(words) {
  state.all = words;
  $("meta").textContent = `${words.length} слов · ${state.source || "словарь"} · прогресс в браузере`;
  const mobileMeta = $("metaMobile");
  if (mobileMeta) mobileMeta.textContent = `${words.length} слов`;
  buildFilters();
  applyFilters();
}

function formsHtml(w) {
  if (!w.past) return "";
  return `<div class="forms">
    <span class="form-chip">Past: <b>${esc(w.past)}</b> ${esc(w.pastTr || "")}</span>
    <span class="form-chip">V3: <b>${esc(w.participle)}</b> ${esc(w.partTr || "")}</span>
  </div>`;
}

function empty() {
  $("stage").innerHTML = `<div class="empty">Нет слов по выбранным фильтрам.</div>`;
}

function renderCards() {
  const w = current();
  if (!w) return empty();
  const s = stats(w);
  $("stage").innerHTML = `
    <div class="session">${state.index + 1} / ${state.deck.length} · ${esc(w.level)} · ${esc(w.category)}</div>
    <div class="card-wrap">
      <div class="flash ${state.flipped ? "flipped" : ""}" id="flash">
        <div class="face front">
          <div class="word">${esc(front(w))}</div>
          ${state.dir === "en-ru" ? `<div class="ipa">${esc(w.transcription)}</div>` : ""}
          <div class="hint">Нажмите, чтобы перевернуть</div>
        </div>
        <div class="face back">
          <div class="word">${esc(back(w))}</div>
          ${state.dir === "ru-en" ? `<div class="ipa">${esc(w.transcription)}</div>` : ""}
          ${formsHtml(w)}
        </div>
      </div>
    </div>
    <div class="card-nav">
      <button class="ghost" id="prevBtn" type="button">← Назад</button>
      <div class="know-btns">
        <button class="ghost bad" id="noBtn" type="button">Не знаю</button>
        <button class="star ${s.starred ? "on" : ""}" id="starBtn" type="button">${s.starred ? "★" : "☆"}</button>
        <button class="ghost ok" id="yesBtn" type="button">Знаю</button>
      </div>
      <button class="ghost" id="nextBtn" type="button">Дальше →</button>
    </div>
  `;
  $("flash").onclick = flip;
  $("prevBtn").onclick = () => step(-1);
  $("nextBtn").onclick = () => step(1);
  $("noBtn").onclick = () => mark(false);
  $("yesBtn").onclick = () => mark(true);
  $("starBtn").onclick = toggleStar;
}

function renderLearn() {
  if (!state.learn) startLearn();
  const q = state.learn;
  if (!q) return empty();
  $("stage").innerHTML = `
    <div class="session">Вопрос ${state.learnN} · ${esc(q.card.level)} · ${esc(q.card.category)}</div>
    <div class="face prompt-card">
      <div class="prompt">${esc(front(q.card))}</div>
      ${state.dir === "en-ru" ? `<div class="ipa">${esc(q.card.transcription)}</div>` : ""}
    </div>
    <div class="choices" id="choices"></div>
    <div class="feedback" id="feedback"></div>
    <div class="card-nav single"><span></span><button class="primary hidden" id="nextLearn" type="button">Дальше</button></div>
  `;
  const box = $("choices");
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.type = "button";
    b.textContent = `${i + 1}. ${opt}`;
    b.onclick = () => answerLearn(opt, b);
    box.appendChild(b);
  });
  $("nextLearn").onclick = () => {
    state.learn = null;
    render();
  };
}

function startLearn() {
  const card = pickCard();
  if (!card) {
    state.learn = null;
    return;
  }
  const correct = back(card);
  const pool = shuffle(state.filtered.filter((x) => x !== card)).slice(0, 3).map(back);
  while (pool.length < 3 && state.all.length > 3) {
    const extra = back(state.all[Math.floor(Math.random() * state.all.length)]);
    if (extra !== correct && !pool.includes(extra)) pool.push(extra);
  }
  state.learnN = (state.learnN || 0) + 1;
  state.learn = {
    card,
    options: shuffle([correct, ...pool].slice(0, 4)),
    correct,
    answered: false,
  };
}

function answerLearn(opt, btn) {
  const q = state.learn;
  if (!q || q.answered) return;
  q.answered = true;
  const ok = opt === q.correct;
  document.querySelectorAll(".choice").forEach((el) => {
    const text = el.textContent.replace(/^\d+\.\s*/, "");
    if (text === q.correct) el.classList.add("right");
  });
  if (!ok) btn.classList.add("wrong");
  $("feedback").textContent = ok ? "Верно" : "Правильный ответ: " + q.correct;
  $("feedback").style.color = ok ? "var(--ok)" : "var(--bad)";
  $("nextLearn").classList.remove("hidden");
  record(q.card, ok);
}

function renderWrite() {
  const card = state.write && state.write.card ? state.write.card : pickCard();
  if (!card) return empty();
  state.write = state.write && state.write.card ? state.write : { card, answered: false };
  const w = state.write.card;
  $("stage").innerHTML = `
    <div class="session">${esc(w.level)} · ${esc(w.category)}</div>
    <div class="face prompt-card">
      <div class="prompt">${esc(front(w))}</div>
      ${state.dir === "en-ru" ? `<div class="ipa">${esc(w.transcription)}</div>` : ""}
    </div>
    <form class="write-box" id="writeForm">
      <input id="writeInput" autocomplete="off" placeholder="Введите перевод" />
      <button class="primary" type="submit">Проверить</button>
    </form>
    <div class="feedback" id="feedback"></div>
    <div class="card-nav single"><span></span><button class="ghost hidden" id="nextWrite" type="button">Дальше</button></div>
  `;
  const input = $("writeInput");
  input.focus();
  $("writeForm").onsubmit = (e) => {
    e.preventDefault();
    checkWrite(input.value);
  };
  $("nextWrite").onclick = () => {
    state.write = null;
    render();
  };
}

function checkWrite(value) {
  const w = state.write.card;
  const expected = back(w);
  const ok = answersMatch(value, w);
  state.write.answered = true;
  const fb = $("feedback");
  fb.style.color = ok ? "var(--ok)" : "var(--bad)";
  fb.innerHTML = ok ? "Верно" : `Ответ: <b>${esc(expected)}</b>`;
  $("nextWrite").classList.remove("hidden");
  record(w, ok);
}

function answersMatch(value, w) {
  const u = normalize(value);
  if (!u) return false;
  if (state.dir === "en-ru") {
    const parts = w.translation.split(/[,;/]/).map(normalize).filter(Boolean);
    return parts.some((p) => p === u || p.startsWith(u) || u === p.split(" ")[0]) || normalize(w.translation) === u;
  }
  const word = normalize(w.word.replace(/\(.*?\)/g, ""));
  return u === word || word.split(" ").includes(u);
}

function renderMatch() {
  if (!state.match || !state.match.left.length) startMatch();
  const m = state.match;
  if (!m) return empty();
  $("stage").innerHTML = `
    <div class="session">Найдите пары · осталось ${m.left.filter((x) => !x.gone).length / 2}</div>
    <div class="match-grid" id="matchGrid"></div>
    <div class="feedback" id="feedback"></div>
    <div class="card-nav single"><span></span><button class="primary hidden" id="nextMatch" type="button">Новый раунд</button></div>
  `;
  const grid = $("matchGrid");
  m.left.forEach((item, i) => {
    const b = document.createElement("button");
    b.className = "match-item" + (item.gone ? " gone" : "") + (m.sel === i ? " selected" : "");
    b.type = "button";
    b.textContent = item.text;
    b.onclick = () => tapMatch(i);
    grid.appendChild(b);
  });
  $("nextMatch").onclick = () => {
    state.match = null;
    render();
  };
  if (m.left.every((x) => x.gone)) {
    $("feedback").textContent = "Все пары найдены";
    $("feedback").style.color = "var(--ok)";
    $("nextMatch").classList.remove("hidden");
  }
}

function startMatch() {
  const sample = shuffle(state.filtered).slice(0, 6);
  if (sample.length < 2) {
    state.match = null;
    return;
  }
  const pairs = sample.map((card) => ({ id: wordId(card), card }));
  const left = shuffle([
    ...pairs.map((p) => ({ id: p.id, text: p.card.word, card: p.card, gone: false })),
    ...pairs.map((p) => ({ id: p.id, text: p.card.translation, card: p.card, gone: false })),
  ]);
  state.match = { left, sel: null };
}

function tapMatch(i) {
  const m = state.match;
  const item = m.left[i];
  if (item.gone) return;
  if (m.sel == null) {
    m.sel = i;
    renderMatch();
    return;
  }
  if (m.sel === i) {
    m.sel = null;
    renderMatch();
    return;
  }
  const a = m.left[m.sel];
  const ok = a.id === item.id && a.text !== item.text;
  if (ok) {
    a.gone = item.gone = true;
    record(item.card, true);
  } else {
    record(item.card, false);
  }
  m.sel = null;
  renderMatch();
}

function renderList() {
  if (!state.filtered.length) return empty();
  const rows = state.filtered
    .map((w) => {
      const s = stats(w);
      return `<div class="list-row">
        <div class="list-word">
          <b>${esc(w.word)}</b>
          <div class="ipa list-ipa">${esc(w.transcription)}</div>
        </div>
        <div class="list-forms">${w.past ? esc(w.past + " / " + w.participle) : ""}</div>
        <div class="list-trans">${esc(w.translation)}</div>
        <button class="star ${s.starred ? "on" : ""}" data-id="${esc(wordId(w))}" type="button">${s.starred ? "★" : "☆"}</button>
      </div>`;
    })
    .join("");
  $("stage").innerHTML = `<div class="list">${rows}</div>`;
  document.querySelectorAll(".star").forEach((btn) => {
    btn.onclick = () => {
      const w = state.all.find((x) => wordId(x) === btn.dataset.id);
      if (!w) return;
      patch(w, { starred: !stats(w).starred });
      renderList();
    };
  });
}

export function flip() {
  state.flipped = !state.flipped;
  renderCards();
}

export function step(d) {
  if (!state.deck.length) return;
  state.index = (state.index + d + state.deck.length) % state.deck.length;
  state.flipped = false;
  renderCards();
}

export function mark(yes) {
  const w = current();
  if (!w) return;
  record(w, yes);
  step(1);
}

export function toggleStar() {
  const w = current();
  if (!w) return;
  patch(w, { starred: !stats(w).starred });
  renderCards();
}

export function render() {
  document.body.classList.toggle("mode-reader", state.mode === "reader");
  document.body.classList.toggle("mode-reading", state.mode === "reader" && !!state.reader.book);
  if (state.mode === "cards") renderCards();
  else if (state.mode === "learn") renderLearn();
  else if (state.mode === "write") renderWrite();
  else if (state.mode === "match") renderMatch();
  else if (state.mode === "reader") renderReader();
  else renderList();
}

export function setFiltersOpen(open) {
  $("sidebar").classList.toggle("open", open);
  $("backdrop").classList.toggle("open", open);
  document.body.classList.toggle("filters-open", open);
}

export function closeInstallModal() {
  $("installModal").classList.add("hidden");
}

export function showInstallHelp() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const file = location.protocol === "file:";
  const box = $("installText");
  if (file) {
    box.innerHTML = `<p>Открой страницу в Safari или Chrome по адресу <code>http://…</code>, не как файл. Затем добавь на экран.</p>
      <ol>
        <li>Скопируй папку приложения на телефон или открой её через локальный сервер.</li>
        <li>Открой <b>index.html</b> в браузере по адресу <code>http://…</code>.</li>
        <li>Нажми «На главный экран» ещё раз.</li>
      </ol>`;
  } else if (ios) {
    box.innerHTML = `<p>В Safari:</p>
      <ol>
        <li>Нажми кнопку «Поделиться» (квадрат со стрелкой).</li>
        <li>Выбери «На экран “Домой”».</li>
        <li>Подтверди «Добавить».</li>
      </ol>`;
  } else {
    box.innerHTML = `<p>В Chrome:</p>
      <ol>
        <li>Меню ⋮ справа сверху.</li>
        <li>«Добавить на главный экран» или «Установить приложение».</li>
      </ol>`;
  }
  $("installModal").classList.remove("hidden");
}
