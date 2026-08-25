import type { FFmpeg } from "@ffmpeg/ffmpeg";

const CORE_BASE = `${import.meta.env.BASE_URL}ffmpeg`;

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ffmpeg = new FFmpeg();

      ffmpeg.on("log", ({ message }) => console.log("[ffmpeg]", message));

      try {
        const coreURL = await toBlobURL(
          `${CORE_BASE}/ffmpeg-core.js`,
          "text/javascript",
        );
        const wasmURL = await toBlobURL(
          `${CORE_BASE}/ffmpeg-core.wasm`,
          "application/wasm",
        );
        await ffmpeg.load({ coreURL, wasmURL });
        console.log("[ffmpeg] loaded successfully");
      } catch (err) {
        console.error("[ffmpeg] RAW load error:", err);
        throw err;
      }
      return ffmpeg;
    })();
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

export type VideoEffect = "none" | "fade" | "zoom" | "zoom-fade";

export interface VideoOptions {
  imageBlob: Blob;
  audioFile: File;
  duration: number;
  width: number;
  height: number;
  effect?: VideoEffect;
  onProgress?: (ratio: number) => void;
}

function parseTimeSeconds(message: string): number | null {
  const m = message.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  const [, hh, mm, ss] = m;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function buildFilter(
  effect: VideoEffect,
  width: number,
  height: number,
  targetSeconds: number,
): string {
  const zoomOn = effect === "zoom" || effect === "zoom-fade";
  const fadeOn = effect === "fade" || effect === "zoom-fade";

  const base = zoomOn
    ? `scale=${Math.round(width * 1.2)}:${Math.round(height * 1.2)},zoompan=z='min(zoom+0.0012,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=15`
    : `scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15`;

  const fadeOutStart = Math.max(0, targetSeconds - 0.6);
  const fade = fadeOn
    ? `,fade=t=in:st=0:d=0.6,fade=t=out:st=${fadeOutStart}:d=0.6`
    : "";

  return `${base}${fade},format=yuv420p`;
}

export async function makeVideo({
  imageBlob,
  audioFile,
  duration,
  width,
  height,
  effect = "none",
  onProgress,
}: VideoOptions): Promise<Blob> {
  const { fetchFile } = await import("@ffmpeg/util");
  const ffmpeg = await getFFmpeg();

  const targetSeconds = Math.max(1, Math.round(duration));

  const onLog = ({ message }: { message: string }) => {
    const t = parseTimeSeconds(message);
    if (t !== null) {
      onProgress?.(Math.min(1, Math.max(0, t / targetSeconds)));
    }
  };
  ffmpeg.on("log", onLog);

  const audioExt = (audioFile.name.split(".").pop() || "mp3").toLowerCase();

  try {
    onProgress?.(0);
    await ffmpeg.writeFile("poster.png", await fetchFile(imageBlob));
    await ffmpeg.writeFile(`track.${audioExt}`, await fetchFile(audioFile));

    const vf = buildFilter(effect, width, height, targetSeconds);
    console.log("[ffmpeg] exec starting...", { effect, vf });

    await ffmpeg.exec([
      "-loop",
      "1",
      "-i",
      "poster.png",
      "-i",
      `track.${audioExt}`,
      "-t",
      String(targetSeconds),
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "stillimage",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);
    console.log("[ffmpeg] exec finished");
    onProgress?.(1);

    const data = await ffmpeg.readFile("output.mp4");
    const bytes =
      data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(String(data));
    return new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
  } finally {
    ffmpeg.off("log", onLog);
    await Promise.allSettled([
      ffmpeg.deleteFile("poster.png"),
      ffmpeg.deleteFile(`track.${audioExt}`),
      ffmpeg.deleteFile("output.mp4"),
    ]);
  }
}
