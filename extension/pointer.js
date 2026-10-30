// OAuthseus pointer: draws a step card and a spotlight on the real provider console.
// Finds elements by their visible label first; falls back to screenshot pointing on request.
(() => {
  if (window.__oauthseusPointer) return;
  window.__oauthseusPointer = true;

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

  let state = null; // { guide: { name, steps }, index, apiBase }
  let targetIdx = 0;
  let current = null; // { el } | { x, y } (viewport fractions, from vision)
  let message = "";
  let busy = false;

  // ---------- DOM ----------
  const host = document.createElement("div");
  host.id = "oauthseus-pointer";
  host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .ring { position: fixed; border: 3px solid #1c6e80; border-radius: 10px; pointer-events: none; display: none;
              box-shadow: 0 0 0 9999px rgba(10, 20, 35, .38); transition: all .18s ease; }
      .ring::after { content: ""; position: absolute; inset: -9px; border: 2px solid #5bb6c9; border-radius: 14px; animation: pulse 1.3s ease-out infinite; }
      @keyframes pulse { from { opacity: .9; transform: scale(.96); } to { opacity: 0; transform: scale(1.08); } }
      @media (prefers-reduced-motion: reduce) { .ring::after { animation: none; } .ring { transition: none; } }
      .tip { position: fixed; max-width: 280px; background: #13233a; color: #fff; font-size: 13px; line-height: 1.4;
             padding: 8px 10px; border-radius: 8px; display: none; pointer-events: none; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
      .card { position: fixed; right: 16px; bottom: 16px; width: 360px; max-width: calc(100vw - 32px); max-height: 70vh; overflow: auto;
              background: #fff; color: #13233a; border: 1px solid #cbd5db; border-radius: 14px; pointer-events: auto;
              box-shadow: 0 18px 50px rgba(10,20,35,.28); font-size: 13.5px; line-height: 1.5; }
      .hd { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #e3e9eb; }
      .brand { font-weight: 700; font-size: 13px; }
      .x { border: 0; background: none; font-size: 18px; cursor: pointer; color: #586a7d; line-height: 1; }
      .bd { padding: 12px 14px; }
      .k { color: #586a7d; font-size: 12px; }
      h3 { margin: 2px 0 8px; font-size: 16px; line-height: 1.3; }
      ol { margin: 0 0 8px; padding-left: 18px; }
      li { margin: 3px 0; }
      .val { display: flex; gap: 6px; align-items: center; background: #eef2f3; border-radius: 6px; padding: 6px 8px; margin: 4px 0; }
      .val code { flex: 1; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
      .status { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #d4e8ec; font-size: 12.5px; }
      .status.warn { background: #f6e7c4; }
      .ft { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #e3e9eb; flex-wrap: wrap; }
      button.b { border: 1px solid #cbd5db; background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px; color: #13233a; }
      button.b:hover { border-color: #1c6e80; }
      button.p { background: #13233a; color: #fff; border-color: #13233a; }
      button.b:disabled { opacity: .45; cursor: default; }
      a { color: #1c6e80; }
      button:focus-visible { outline: 2px solid #1c6e80; outline-offset: 2px; }
    </style>
    <div class="ring"></div>
    <div class="tip"></div>
    <div class="card" role="dialog" aria-label="OAuthseus walkthrough"></div>`;
  const ring = root.querySelector(".ring");
  const tip = root.querySelector(".tip");
  const card = root.querySelector(".card");

  // ---------- Element finding ----------
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const SELECTORS = {
    button: 'button, [role="button"], input[type="submit"], input[type="button"], a',
    link: 'a, [role="link"], [role="menuitem"], [role="tab"], [role="treeitem"], button',
    tab: '[role="tab"], a, button',
    menu: '[role="menuitem"], nav a, a, button, [role="treeitem"]',
    field: "label, input, textarea, select, [role='combobox'], [contenteditable='true']",
    any: 'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], label, input, textarea, select, h1, h2, h3, span',
  };

  function visible(el) {
    if (!el || host.contains(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  }

  function labelOf(el) {
    return norm(el.getAttribute?.("aria-label") || el.innerText || el.value || el.placeholder || el.title || "");
  }

  function fieldFor(labelEl) {
    if (labelEl.htmlFor) return document.getElementById(labelEl.htmlFor) || labelEl;
    return labelEl.querySelector("input, textarea, select") || labelEl.parentElement?.querySelector("input, textarea, select") || labelEl;
  }

  function* allRoots(start = document) {
    yield start;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) if (n.shadowRoot && n !== host) yield* allRoots(n.shadowRoot);
  }

  function find(target) {
    const want = norm(target.text);
    if (!want) return null;
    const sel = SELECTORS[target.kind] || SELECTORS.any;
    let best = null;
    let bestScore = 0;
    for (const r of allRoots()) {
      for (const el of r.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        const l = labelOf(el);
        if (!l || l.length > want.length * 4 + 40) continue;
        let score = 0;
        if (l === want) score = 3;
        else if (l.startsWith(want)) score = 2;
        else if (l.includes(want)) score = 1;
        // Placeholders and aria-labels on inputs count for fields.
        if (!score && target.kind === "field" && norm(el.placeholder || el.getAttribute?.("aria-label")).includes(want)) score = 2;
        // Prefer the smallest matching element (the actual button, not its container).
        if (score > bestScore || (score === bestScore && score > 0 && best && el.contains(best) === false && best.contains(el))) {
          best = el;
          bestScore = score;
        }
      }
    }
    if (best && target.kind === "field" && best.tagName === "LABEL") return fieldFor(best);
    return best;
  }

  // ---------- Rendering ----------
  const step = () => state.guide.steps[state.index];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function onRightPage() {
    try {
      return new RegExp(step().pointer.urlPattern).test(location.href);
    } catch {
      return true;
    }
  }

  function renderCard() {
    const s = step();
    const n = state.guide.steps.length;
    const t = s.pointer.targets[targetIdx];
    const right = onRightPage();
    card.innerHTML = `
      <div class="hd"><span class="brand">OAuthseus · ${esc(state.guide.name)}</span><button class="x" data-a="close" aria-label="End walkthrough">×</button></div>
      <div class="bd">
        <div class="k">Step ${state.index + 1} of ${n}</div>
        <h3>${esc(s.title)}</h3>
        <ol>${s.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>
        ${(s.values || []).map((v) => `<div class="val"><span class="k">${esc(v.field)}</span><code>${esc(v.value)}</code><button class="b" data-copy="${esc(v.value)}">Copy</button></div>`).join("")}
        ${!right ? `<div class="status warn">This step happens on another page. <a href="${esc(s.pointer.startUrl)}">Go there</a></div>` : ""}
        <div class="status ${current ? "" : "warn"}">${
          message ||
          (current
            ? `Highlighted: <b>${esc(t ? t.text : "")}</b>${t?.hint ? `. ${esc(t.hint)}` : ""}`
            : t
              ? `Looking for “${esc(t.text)}”… If the console has changed, try “Point for me”.`
              : "Nothing to highlight for this step.")
        }</div>
      </div>
      <div class="ft">
        <button class="b" data-a="prev" ${state.index === 0 ? "disabled" : ""}>Back</button>
        <button class="b" data-a="target" ${s.pointer.targets.length < 2 ? "disabled" : ""}>Next highlight</button>
        <button class="b" data-a="point" ${busy ? "disabled" : ""}>${busy ? "Looking…" : "Point for me"}</button>
        <button class="b p" data-a="next">${state.index === n - 1 ? "Finish" : "Next step"}</button>
      </div>`;
  }

  function place() {
    let r = null;
    if (current?.el) {
      if (!current.el.isConnected || !visible(current.el)) {
        current = null;
        return hide();
      }
      r = current.el.getBoundingClientRect();
    } else if (current && "x" in current) {
      const cx = current.x * innerWidth;
      const cy = current.y * innerHeight;
      r = { left: cx - 40, top: cy - 18, width: 80, height: 36, bottom: cy + 18 };
    }
    if (!r) return hide();
    const pad = 6;
    Object.assign(ring.style, { display: "block", left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const t = step().pointer.targets[targetIdx];
    tip.textContent = current.explanation || t?.hint || t?.text || "";
    const below = r.bottom + 14 + 60 < innerHeight;
    Object.assign(tip.style, { display: tip.textContent ? "block" : "none", left: `${Math.max(8, Math.min(innerWidth - 290, r.left))}px`, top: below ? `${r.bottom + 14}px` : `${Math.max(8, r.top - 70)}px` });
  }

  function hide() {
    ring.style.display = "none";
    tip.style.display = "none";
  }

  function locate() {
    if (!state || current?.x !== undefined) return;
    const t = step().pointer.targets[targetIdx];
    const el = t && onRightPage() ? find(t) : null;
    const changed = (el || null) !== (current?.el || null);
    current = el ? { el } : null;
    if (el && changed) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    if (changed) renderCard();
  }

  async function goTo(index) {
    state = await send({ type: "set-index", index });
    targetIdx = 0;
    current = null;
    message = "";
    renderCard();
    locate();
    if (!onRightPage() && step().pointer.startUrl && new URL(step().pointer.startUrl).host !== location.host) {
      location.href = step().pointer.startUrl;
    }
  }

  async function pointForMe() {
    busy = true;
    message = "Taking a screenshot of this tab and finding the right element…";
    renderCard();
    host.style.visibility = "hidden";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = await send({ type: "point" });
    host.style.visibility = "visible";
    busy = false;
    if (!res || res.error) {
      message = `Couldn't point: ${esc(res?.error || "no response")}`;
    } else if (res.wrongPage) {
      current = null;
      message = `Wrong page: ${esc(res.explanation)}`;
    } else if (!res.found) {
      current = null;
      message = `Couldn't find it on screen. ${esc(res.explanation || "")}`;
    } else {
      current = { x: res.x, y: res.y, explanation: res.explanation };
      message = `Found <b>${esc(res.label)}</b> from the screenshot. ${esc(res.explanation)}`;
    }
    renderCard();
  }

  card.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.copy) {
      navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Copied";
      return;
    }
    const a = btn.dataset.a;
    if (a === "close" || (a === "next" && state.index === state.guide.steps.length - 1)) {
      await send({ type: "stop" });
      host.remove();
      window.__oauthseusPointer = false;
      return;
    }
    if (a === "next") return goTo(state.index + 1);
    if (a === "prev") return goTo(state.index - 1);
    if (a === "target") {
      targetIdx = (targetIdx + 1) % step().pointer.targets.length;
      current = null;
      message = "";
      renderCard();
      return locate();
    }
    if (a === "point") return pointForMe();
  });

  // When the developer clicks the highlighted element, move to the next target in this step.
  document.addEventListener(
    "click",
    (e) => {
      if (!state || !current?.el || host.contains(e.target)) return;
      if (current.el === e.target || current.el.contains(e.target)) {
        const targets = step().pointer.targets;
        if (targetIdx < targets.length - 1) {
          targetIdx++;
          current = null;
          message = "";
          setTimeout(() => {
            renderCard();
            locate();
          }, 400);
        } else {
          message = "Done with this step. Click “Next step” when you're ready.";
          setTimeout(renderCard, 300);
        }
      }
    },
    true,
  );

  // ---------- Boot ----------
  (async () => {
    state = await send({ type: "get-state" });
    if (!state) return;
    const hosts = new Set(state.guide.steps.map((s) => new URL(s.pointer.startUrl).host));
    const patternHit = state.guide.steps.some((s) => {
      try {
        return new RegExp(s.pointer.urlPattern).test(location.href);
      } catch {
        return false;
      }
    });
    if (!hosts.has(location.host) && !patternHit) return;
    document.documentElement.appendChild(host);
    renderCard();
    locate();
    // Consoles are single-page apps; keep looking as the DOM and URL change.
    setInterval(locate, 900);
    const loop = () => {
      place();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();
})();
