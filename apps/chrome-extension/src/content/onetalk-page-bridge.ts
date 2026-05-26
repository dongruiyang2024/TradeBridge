import { getChrome } from "../shared/chrome-api.js";

const loginRequired =
  /login\.alibaba\.com|newlogin/i.test(location.href) || Boolean(document.querySelector("input[type='password']"));

void getChrome().runtime.sendMessage({
  type: loginRequired ? "onetalk-login-required" : "onetalk-page-ready",
  url: location.href
});
