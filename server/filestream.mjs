// 把「存储 + 路径」的文件流出去：本地走 sendFile（支持 Range），远端走管道的流式转发。
import { stat as fsStat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { driverFor } from "./drives.mjs";
import { mimeOf, sendFile } from "./util.mjs";

const nameOf = (target) => String(target || "").split("/").filter(Boolean).pop() || "";

export async function streamPath(req, res, { drive, target, download = false }) {
  const driver = driverFor(drive);
  const downloadAs = download ? nameOf(target) : undefined;
  const mime = mimeOf(target);
  // 图片/视频加载过一次就让浏览器自己留着，下次直接命中本地缓存。
  const cacheable = !downloadAs && /^(image|video|audio)\//.test(mime);
  const cache = cacheable ? "private, max-age=604800" : "private, max-age=300";

  if (drive.driver === "local") {
    const filePath = await driver.filePath(target);
    const info = await fsStat(filePath);
    if (info.isDirectory()) throw Object.assign(new Error("这是目录"), { status: 400 });
    return sendFile(req, res, filePath, { mime, cache, downloadAs });
  }

  const remote = await driver.download(target);
  const headers = {
    "content-type": remote.mime || mime,
    "cache-control": cache,
  };
  if (remote.size && !remote.encoding) headers["content-length"] = String(remote.size);
  if (downloadAs) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadAs)}`;
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    remote.stream?.cancel?.();
    return res.end();
  }
  try {
    await pipeline(remote.stream, res);
  } catch (error) {
    console.error("[memories] 下载中断", error.message);
    if (!res.writableEnded) res.destroy(error);
  }
}
