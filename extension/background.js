// Holds the active walkthrough, opens the console, and does screenshot pointing on request.

const KEY = "walkthrough";

async function getState() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? null;
}
async function setState(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

function pointerSteps(guide) {
  return guide.steps.filter((s) => s.pointer);
}

async function downscale(dataUrl, maxWidth = 1280) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { image: btoa(bin), width: w, height: h };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "start") {
      const steps = pointerSteps(msg.guide);
      if (steps.length === 0) return sendResponse({ ok: false });
      await setState({ guide: { name: msg.guide.name, slug: msg.guide.slug, steps }, index: 0, apiBase: msg.apiBase });
      await chrome.tabs.create({ url: steps[0].pointer.startUrl });
      return sendResponse({ ok: true });
    }
    if (msg.type === "get-state") return sendResponse(await getState());
    if (msg.type === "set-index") {
      const s = await getState();
      if (s) {
        s.index = Math.max(0, Math.min(s.guide.steps.length - 1, msg.index));
        await setState(s);
      }
      return sendResponse(s);
    }
    if (msg.type === "stop") {
      await chrome.storage.local.remove(KEY);
      return sendResponse({ ok: true });
    }
    if (msg.type === "point") {
      const s = await getState();
      if (!s) return sendResponse({ error: "No walkthrough is active." });
      try {
        const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 80 });
        const img = await downscale(shot);
        const step = s.guide.steps[s.index];
        const res = await fetch(`${s.apiBase}/api/point`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...img, step: { title: step.title, instructions: step.instructions, targets: step.pointer.targets } }),
        });
        return sendResponse(await res.json());
      } catch (err) {
        return sendResponse({ error: String(err?.message ?? err) });
      }
    }
  })();
  return true; // async response
});

// For hosts not in the manifest (agent-generated guides), clicking the toolbar icon grants
// activeTab for this page and injects the pointer.
chrome.action.onClicked.addListener(async (tab) => {
  if (!(await getState())) {
    await chrome.tabs.create({ url: "http://localhost:3000/extension" });
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["pointer.js"] });
});
