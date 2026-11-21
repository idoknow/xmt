// CI 用：把新镜像切到 Deployment，等滚动完成，再从公网确认站点可用。
// 环境变量：K8S_TOKEN、K8S_BASE、IMAGE（如 ghcr.io/idoknow/xmt:sha-ab12cd3）
// 可选：SITE_URL、ROLLOUT_TIMEOUT（秒）

import { getDeployment, k8s, listPods, NAMESPACE, sleep } from "./lib.mjs";

const IMAGE = process.env.IMAGE;
const NAME = process.env.DEPLOYMENT ?? "xmt";
const SITE_URL = process.env.SITE_URL ?? "https://xmt.idoknow.top";
const TIMEOUT = Number(process.env.ROLLOUT_TIMEOUT ?? 300) * 1000;

const DEPLOYMENT_PATH = `/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${NAME}`;

async function switchImage(image) {
  const current = await getDeployment(NAME);
  const containers = current.spec.template.spec.containers;
  const target = containers.find((c) => c.name === "web") ?? containers[0];
  if (target.image === image) {
    console.log(`镜像已是 ${image}，跳过切换`);
    return;
  }

  // 用 strategic merge patch：按容器名合并，只改 image，不碰别的字段，
  // 也不会因 resourceVersion 过期而 409（先前 PUT 整对象会在控制器写 status 后必然撞 409）。
  const patch = {
    spec: { template: { spec: { containers: [{ name: target.name, image }] } } },
  };

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await k8s("PATCH", DEPLOYMENT_PATH, patch, "application/strategic-merge-patch+json");
      console.log(`镜像 ${target.image} → ${image}`);
      return;
    } catch (error) {
      lastError = error;
      const conflict = /→ 409/.test(String(error.message));
      console.log(`切换失败（第 ${attempt} 次）：${error.message.split("\n")[0]}${conflict ? "（版本冲突，重试）" : ""}`);
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

async function waitReady() {
  const deadline = Date.now() + TIMEOUT;
  let last = "等待中";

  while (Date.now() < deadline) {
    const deployment = await getDeployment(NAME);
    const status = deployment.status ?? {};
    const want = deployment.spec.replicas ?? 1;
    const generation = deployment.metadata.generation;
    const observed = status.observedGeneration ?? 0;

    const pods = await listPods("app=xmt");
    const ready = pods.filter((pod) => pod.status?.phase === "Running" && pod.status?.containerStatuses?.every((c) => c.ready));
    const images = [...new Set(ready.flatMap((pod) => pod.spec.containers.map((c) => c.image)))];

    last = `updated=${status.updatedReplicas ?? 0}/${want} available=${status.availableReplicas ?? 0} ready pods=${ready.length} images=${images.join(",") || "-"}`;
    console.log(`  ${last}`);

    const rolledOut =
      observed >= generation &&
      (status.updatedReplicas ?? 0) === want &&
      (status.availableReplicas ?? 0) >= want &&
      ready.length >= want;

    if (rolledOut) {
      console.log(`滚动完成：${last}`);
      return pods;
    }
    await sleep(6000);
  }

  throw new Error(`等待滚动超时（${TIMEOUT / 1000}s）：${last}`);
}

async function verifySite() {
  const deadline = Date.now() + 120_000;
  let last = "";

  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${SITE_URL}/healthz.txt?ts=${Date.now()}`, { cache: "no-store" });
      const healthText = (await health.text()).trim();
      const home = await fetch(`${SITE_URL}/?ts=${Date.now()}`, { cache: "no-store" });
      const html = await home.text();
      const build = /<meta name="xmt-build" content="([^"]+)"/.exec(html)?.[1] ?? "-";

      last = `healthz=${health.status}/${healthText} home=${home.status} cache=${home.headers.get("cache-control")} build=${build}`;
      console.log(`  ${last}`);

      if (health.ok && healthText === "ok" && home.ok && html.includes("桂林中学新媒体")) {
        console.log("公网校验通过");
        return;
      }
    } catch (error) {
      last = `请求失败：${error.message}`;
      console.log(`  ${last}`);
    }
    await sleep(5000);
  }

  throw new Error(`公网校验失败：${last}`);
}

const image = IMAGE ?? (await getDeployment(NAME)).spec.template.spec.containers[0].image;
await switchImage(image);
await waitReady();
await verifySite();
