// 手动把 Deployment / Service / Ingress 应用到集群（幂等）。
// 用法：K8S_TOKEN=... node deploy/apply.mjs
// 可选：K8S_BASE=... 覆盖 Rancher 代理地址

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyObject } from "./lib.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "k8s");

const files = (await readdir(DIR)).filter((name) => name.endsWith(".json")).sort();

for (const file of files) {
  const manifest = JSON.parse(await readFile(path.join(DIR, file), "utf8"));
  const result = await applyObject(manifest);
  const kind = result?.kind ?? manifest.kind;
  const name = result?.metadata?.name ?? manifest.metadata.name;
  console.log(`applied ${kind}/${name} (image: ${result?.spec?.template?.spec?.containers?.[0]?.image ?? "-"})`);
}
