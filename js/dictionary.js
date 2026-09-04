export function parseDictionary(text, name = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const looksJson =
    /\.json$/i.test(name) || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) return flattenWords(JSON.parse(trimmed));
  return parseMarkdown(trimmed);
}

export function flattenWords(data) {
  if (Array.isArray(data)) {
    return data.map(normalizeWord).filter((w) => w.word);
  }
  if (!data || !Array.isArray(data.levels)) {
    throw new Error("bad dictionary");
  }
  const words = [];
  for (const level of data.levels) {
    const levelName = level.name || "";
    for (const cat of level.categories || []) {
      const catName = cat.name || "";
      for (const w of cat.words || []) {
        const item = normalizeWord({
          ...w,
          level: w.level || levelName,
          category: w.category || catName,
        });
        if (item.word) words.push(item);
      }
    }
  }
  return words;
}

function normalizeWord(w) {
  const item = {
    level: w.level || "",
    category: w.category || "",
    word: String(w.word || w.en || "").trim(),
    transcription: String(w.transcription || w.ipa || "").trim(),
    translation: String(w.translation || w.ru || "").trim(),
  };
  if (w.past) {
    item.past = w.past;
    item.pastTr = w.pastTr || w.pastTranscription || "";
    item.participle = w.participle || w.v3 || "";
    item.partTr = w.partTr || w.participleTranscription || "";
  }
  return item;
}

export function parseMarkdown(text) {
  const words = [];
  let level = "";
  let category = "";
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      level = line.slice(3).trim();
      category = "";
      continue;
    }
    if (line.startsWith("### ")) {
      category = line.slice(4).trim();
      continue;
    }
    if (!line.startsWith("|") || line.includes("---")) continue;

    const headers = line.split("|").map((s) => s.trim()).filter(Boolean);
    i += 1;
    if (i < lines.length && lines[i].includes("---")) i += 1;

    while (i < lines.length && lines[i].startsWith("|") && !lines[i].includes("---")) {
      const clean = lines[i].replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
      if (clean[0]) {
        const item = {
          level,
          category,
          word: clean[0],
          transcription: clean[1] || "",
          translation: clean[clean.length - 1] || "",
        };
        if (headers[0] && headers[0].startsWith("Инфинитив") && clean.length >= 7) {
          item.past = clean[2];
          item.pastTr = clean[3];
          item.participle = clean[4];
          item.partTr = clean[5];
          item.translation = clean[6];
        }
        words.push(item);
      }
      i += 1;
    }
    i -= 1;
  }

  return words;
}
