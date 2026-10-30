// Runs on the OAuthyseus site. Lets the guide page detect the extension and hand it a guide.
document.documentElement.dataset.oauthyseusExt = "installed";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== "oauthyseus-page" || msg.type !== "start-walkthrough" || !msg.guide) return;
  chrome.runtime.sendMessage({ type: "start", guide: msg.guide, apiBase: location.origin });
});
