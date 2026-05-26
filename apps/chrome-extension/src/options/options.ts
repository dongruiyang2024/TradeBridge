document.querySelector<HTMLFormElement>("#options-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#options-status")?.replaceChildren("配置页面已加载，存储逻辑在任务 4 接入。");
});
