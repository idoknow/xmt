// 集群访问：全部走 Rancher 的 K8s 代理（token 只在 idoknow 命名空间有权限）
// 环境变量：K8S_BASE（Rancher 代理地址）、K8S_TOKEN（Bearer token）

const BASE = process.env.K8S_BASE ?? "https://rancher.rockchin.top/k8s/clusters/local";
const TOKEN = process.env.K8S_TOKEN;

export const NAMESPACE = process.env.K8S_NAMESPACE ?? "idoknow";

function authToken() {
  if (!TOKEN) {
    throw new Error("缺少 K8S_TOKEN（Rancher Bearer token）");
  }
  return TOKEN;
}

export async function k8s(method, path, body, contentType = "application/json") {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${authToken()}`,
      accept: "application/json",
      ...(body ? { "content-type": contentType } : {}),
    },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail = json?.message ?? text.slice(0, 400);
    throw new Error(`${method} ${path} → ${response.status} ${detail}`);
  }
  return json;
}

/** 先看存在与否：不存在就 POST 建，存在就 merge patch 改，重复执行结果一致 */
export async function applyObject(manifest) {
  const { apiVersion, kind, metadata } = manifest;
  const group = apiVersion.includes("/") ? apiVersion.split("/")[0] : "";
  const version = apiVersion.includes("/") ? apiVersion.split("/")[1] : apiVersion;

  const collection = {
    Deployment: "deployments",
    Service: "services",
    Ingress: "ingresses",
  }[kind];
  if (!collection) throw new Error(`不支持的资源类型：${kind}`);

  const prefix = group ? `/apis/${group}/${version}` : `/api/${version}`;
  const base = `${prefix}/namespaces/${metadata.namespace ?? NAMESPACE}/${collection}`;
  const path = `${base}/${metadata.name}`;

  try {
    await k8s("GET", path);
  } catch (error) {
    if (!/→ 404/.test(error.message)) throw error;
    return k8s("POST", base, manifest);
  }

  return k8s("PATCH", path, manifest, "application/merge-patch+json");
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getDeployment(name) {
  return k8s("GET", `/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${name}`);
}

export async function listPods(labelSelector) {
  const data = await k8s(
    "GET",
    `/api/v1/namespaces/${NAMESPACE}/pods?labelSelector=${encodeURIComponent(labelSelector)}`,
  );
  return data.items ?? [];
}
