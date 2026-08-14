// 加载页：接收主进程推送的网关状态，展示进度与日志
(function () {
  "use strict";

  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");
  const logEl = document.getElementById("log");

  let logCount = 0;

  function appendLog(line) {
    logEl.classList.add("visible");
    logCount += 1;
    logEl.textContent += line + "\n";
    // 最多保留 200 行，避免长日志拖垮页面
    if (logCount > 200) {
      const keep = logEl.textContent.split("\n").slice(-200).join("\n");
      logEl.textContent = keep;
      logCount = 200;
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  const api = window.harnessDesktop;
  if (api && typeof api.onGatewayStatus === "function") {
    api.onGatewayStatus(({ state, message, log }) => {
      if (message) statusEl.textContent = message;
      if (log) appendLog(log);
      if (state === "ready") {
        statusEl.textContent = message || "网关已就绪，正在打开界面…";
      } else if (state === "error") {
        document.body.classList.add("error");
        statusEl.textContent = "网关启动失败";
        detailEl.textContent = message || "";
      }
    });
    if (typeof api.ready === "function") api.ready();
  } else {
    statusEl.textContent = "正在打开界面…";
  }
})();
