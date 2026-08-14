// 网关模块冒烟测试（纯 Node，不需要 Electron）
// 用法：node test/gateway-smoke.mjs
// 说明：使用工作区内的临时 DSH_HOME 与空闲端口，验证
//   解析 dsh 入口 → 拉起网关 → 探测就绪 → HTTP 内容 → 停止网关 全链路。

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayManager, resolveDshEntry, resolveNodePath } from "../lib/gateway.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PORT = 3199; // 空闲测试端口
const work = mkdtempSync(path.join(root, ".smoke-"));
const dshHome = path.join(work, "dsh-home");
const logFile = path.join(work, "gateway.log");
const pidFile = path.join(work, "gateway.pid");

let failed = false;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) failed = true;
};

// 用工作区内的 DSH_HOME，避免触碰真实用户数据
process.env.DSH_HOME = dshHome;
process.env.DSH_TELEMETRY_DISABLED = "1";

const dshEntry = resolveDshEntry();
check("解析 dsh 启动入口", typeof dshEntry === "string" && existsSync(dshEntry), dshEntry || "(未找到)");

const nodePath = resolveNodePath();
check("解析 node 可执行文件", typeof nodePath === "string", nodePath);

const gw = new GatewayManager({
  workspace: root,
  port: PORT,
  nodePath,
  dshBinJs: dshEntry,
  logFile,
  pidFile,
  onLog: (line) => console.log("  [gateway]", line),
});

try {
  const probeBefore = await gw.probe();
  check(`启动前端口 ${PORT} 应空闲`, probeBefore === "down", `probe=${probeBefore}`);

  const result = await gw.ensureRunning({ timeoutMs: 180000 });
  check("网关被本客户端拉起", result.started === true, JSON.stringify(result));

  const probeAfter = await gw.probe();
  check("探测到 Harness 页面", probeAfter === "harness", `probe=${probeAfter}`);

  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await res.text();
  check("HTTP 返回 Harness 页面", res.status === 200 && html.includes("DeepSeek Harness"), `status=${res.status}, len=${html.length}`);

  // 第二次 ensureRunning 应直接复用
  const reuse = await gw.ensureRunning({ timeoutMs: 5000 });
  check("再次调用直接复用已有网关", reuse.reused === true, JSON.stringify(reuse));

  await gw.stop();
  const probeAfterStop = await gw.probe();
  check("停止后端口应释放", probeAfterStop === "down", `probe=${probeAfterStop}`);

  console.log("--- 网关日志尾部 ---");
  console.log(gw.readLogTail(12));
} catch (err) {
  failed = true;
  console.error("SMOKE ERROR:", err);
  console.error("--- 日志尾部 ---");
  console.error(gw.readLogTail(40));
} finally {
  try {
    await gw.stop();
  } catch {
    /* ignore */
  }
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE OK");
process.exit(failed ? 1 : 0);
