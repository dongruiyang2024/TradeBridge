import { getChrome } from "../shared/chrome-api.js";

void getChrome().runtime.sendMessage({
  type: "onetalk-page-ready",
  url: location.href
});
