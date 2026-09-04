import { unzip } from "./zip.js";

const ALLOWED = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "EM", "STRONG", "I", "B", "BR",
  "BLOCKQUOTE", "UL", "OL", "LI", "IMG", "DIV", "SPAN", "SECTION", "ARTICLE",
  "HR", "TABLE", "TR", "TD", "TH", "TBODY", "THEAD", "SUB", "SUP", "SMALL",
  "ABBR", "CODE", "PRE", "FIGURE", "FIGCAPTION", "HEADER", "FOOTER", "NAV",
  "DL", "DT", "DD",
]);

export function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((s) => s && s !== ".")
    .join("/");
}

export function joinPath(dir, href) {
  const path = String(href || "").split("#")[0].split("?")[0];
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) return "";
  const combined = normPath((dir ? dir + "/" : "") + path);
  const parts = [];
  for (const part of combined.split("/")) {
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function getFile(files, path) {
  const n = normPath(path);
  if (!n) return null;
  const variants = [n];
  try {
    variants.push(decodeURIComponent(n));
  } catch { /* ignore */ }
  for (const name of variants) {
    if (files.has(name)) return files.get(name);
    const lower = name.toLowerCase();
    for (const [key, value] of files) {
      if (key.toLowerCase() === lower) return value;
    }
  }
  return null;
}

function decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function xml(bytes, type) {
  return new DOMParser().parseFromString(decode(bytes), type);
}

function tags(doc, localName) {
  return [...doc.getElementsByTagNameNS("*", localName)];
}

function attr(el, name) {
  if (!el) return "";
  return (
    el.getAttribute(name) ||
    el.getAttribute(name.toLowerCase()) ||
    el.getAttributeNS("http://www.idpf.org/2007/opf", name) ||
    el.getAttributeNS("http://www.w3.org/1999/xlink", name) ||
    ""
  );
}

function firstText(doc, names) {
  for (const name of names) {
    const local = name.includes(":") ? name.split(":")[1] : name;
    for (const node of tags(doc, local)) {
      const text = (node.textContent || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function dirName(path) {
  const n = normPath(path);
  const i = n.lastIndexOf("/");
  return i === -1 ? "" : n.slice(0, i);
}

function mimeOf(path) {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function tocMap(files, opfDir, opf) {
  const map = new Map();
  const items = tags(opf, "item");
  const nav = items.find((item) => /\bnav\b/i.test(attr(item, "properties")));
  const ncx = items.find((item) => /ncx/i.test(attr(item, "media-type")));
  const file = nav || ncx;
  if (!file) return map;
  const bytes = getFile(files, joinPath(opfDir, attr(file, "href")));
  if (!bytes) return map;
  const doc = xml(bytes, nav ? "application/xhtml+xml" : "application/xml");
  const links = [...tags(doc, "a"), ...tags(doc, "content")];
  for (const link of links) {
    const href = link.getAttribute("href") || attr(link, "src") || "";
    const title = (link.textContent || "").replace(/\s+/g, " ").trim();
    const path = joinPath(dirName(joinPath(opfDir, attr(file, "href"))), href);
    if (path && title && !map.has(path)) map.set(path, title);
  }
  return map;
}

export async function parseEpub(buffer) {
  const files = await unzip(buffer);
  if (getFile(files, "META-INF/encryption.xml")) {
    throw new Error("Эта книга защищена DRM и не открывается");
  }
  const container = getFile(files, "META-INF/container.xml");
  if (!container) throw new Error("Нет container.xml — это не EPUB");
  const containerDoc = xml(container, "application/xml");
  const root = tags(containerDoc, "rootfile")[0];
  const opfPath = normPath(attr(root, "full-path"));
  const opfBytes = getFile(files, opfPath);
  if (!opfBytes) throw new Error("Не найден content.opf");
  const opf = xml(opfBytes, "application/xml");
  const opfDir = dirName(opfPath);
  const manifest = new Map();
  for (const item of tags(opf, "item")) {
    manifest.set(attr(item, "id"), {
      href: joinPath(opfDir, attr(item, "href")),
      type: attr(item, "media-type"),
      properties: attr(item, "properties"),
    });
  }
  const titles = tocMap(files, opfDir, opf);
  const chapters = [];
  for (const ref of tags(opf, "itemref")) {
    const item = manifest.get(attr(ref, "idref"));
    if (!item || !/html|xml|svg/i.test(item.type || "html")) continue;
    if (/\bnav\b/i.test(item.properties || "")) continue;
    chapters.push({
      href: item.href,
      title: titles.get(item.href) || "",
    });
  }
  if (!chapters.length) throw new Error("В книге нет глав");
  return {
    title: firstText(opf, ["title"]) || "Без названия",
    author: firstText(opf, ["creator"]) || "",
    opfDir,
    files,
    chapters,
  };
}

function headingTitle(root) {
  const h = root.querySelector("h1, h2, h3, title");
  return h ? (h.textContent || "").replace(/\s+/g, " ").trim() : "";
}

export function renderChapter(book, index) {
  const chapter = book.chapters[index];
  if (!chapter) return { html: "", blobs: [], title: "" };
  const bytes = getFile(book.files, chapter.href);
  if (!bytes) return { html: "<p>Не удалось прочитать главу.</p>", blobs: [], title: chapter.title };
  let doc = xml(bytes, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) doc = xml(bytes, "text/html");
  const body = doc.body || doc.getElementsByTagName("body")[0] || doc.documentElement;
  const blobs = [];
  const base = dirName(chapter.href);
  const root = document.createElement("div");
  root.innerHTML = body ? body.innerHTML : decode(bytes);
  if (!root.innerHTML.trim() && body) {
    const p = document.createElement("p");
    p.textContent = body.textContent || "";
    root.appendChild(p);
  }

  [...root.querySelectorAll("*")].forEach((el) => {
    if (!el.isConnected) return;
    if (!ALLOWED.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "style" || name === "width" || name === "height" || name === "align") {
        el.removeAttribute(a.name);
      }
    });
    if (el.tagName === "A") {
      const span = document.createElement("span");
      span.innerHTML = el.innerHTML;
      el.replaceWith(span);
      return;
    }
    if (el.tagName === "IMG") {
      const src = joinPath(base, el.getAttribute("src") || "");
      const data = getFile(book.files, src);
      if (!data) {
        el.remove();
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: mimeOf(src) }));
      blobs.push(url);
      el.setAttribute("src", url);
      el.removeAttribute("srcset");
    }
  });

  return {
    html: root.innerHTML,
    blobs,
    title: chapter.title || headingTitle(root) || `Глава ${index + 1}`,
  };
}
