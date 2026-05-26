import { getChrome } from "../shared/chrome-api.js";

const chromeApi = getChrome();
const status = document.querySelector<HTMLParagraphElement>("#status");

document.querySelector<HTMLButtonElement>("#sync-now")?.addEventListener("click", async () => {
  status?.replaceChildren("同步中...");
  const result = await chromeApi.runtime.sendMessage({ type: "sync-now" });
  status?.replaceChildren(JSON.stringify(result));
});

document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
  chromeApi.runtime.openOptionsPage();
});
