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

export type VideoEffect =
  | "none"
  | "fade"
  | "zoom-in"
  | "zoom-in-fade"
  | "zoom-out"
  | "zoom-out-fade"
  | "pan-right"
  | "pan-right-fade"
  | "pan-left"
  | "pan-left-fade"
  | "pan-down"
  | "pan-down-fade";

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
  const fadeOn = effect.includes("fade");
  const effectType = effect.replace("-fade", "");

  // Make sure output dimensions are strictly even numbers for yuv420p format compatibility
  const outW = width % 2 === 0 ? width : width + 1;
  const outH = height % 2 === 0 ? height : height + 1;

  let base = `scale=${outW}:${outH},fps=15`;

  const totalFrames = targetSeconds * 15;
  // Set explicit duration to prevent zoompan internal reset
  const d = totalFrames + 100;

  // Scale up the image by 20% to allow space for panning and zooming without losing quality
  const scaledW = Math.round(width * 1.2);
  const scaledH = Math.round(height * 1.2);
  const sW = scaledW % 2 === 0 ? scaledW : scaledW + 1;
  const sH = scaledH % 2 === 0 ? scaledH : scaledH + 1;

  const zScale = `scale=${sW}:${sH}`;

  if (effectType === "zoom-in" || effectType === "zoom") {
    base = `${zScale},zoompan=z='min(1+0.15*(on/${totalFrames}),1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:s=${outW}x${outH}:fps=15`;
  } else if (effectType === "zoom-out") {
    base = `${zScale},zoompan=z='max(1.15-0.15*(on/${totalFrames}),1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:s=${outW}x${outH}:fps=15`;
  } else if (effectType === "pan-right") {
    base = `${zScale},zoompan=z='1.15':x='(iw-iw/zoom)*(on/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${d}:s=${outW}x${outH}:fps=15`;
  } else if (effectType === "pan-left") {
    base = `${zScale},zoompan=z='1.15':x='(iw-iw/zoom)*(1-(on/${totalFrames}))':y='ih/2-(ih/zoom/2)':d=${d}:s=${outW}x${outH}:fps=15`;
  } else if (effectType === "pan-down") {
    base = `${zScale},zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${totalFrames})':d=${d}:s=${outW}x${outH}:fps=15`;
  }

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
      // Progress calculation up to 90%, remaining 10% is for attaching the thumbnail
      onProgress?.(Math.min(0.9, Math.max(0, t / targetSeconds) * 0.9));
    }
  };

  ffmpeg.on("log", onLog);
  const audioExt = (audioFile.name.split(".").pop() || "mp3").toLowerCase();

  try {
    onProgress?.(0);
    await ffmpeg.writeFile("poster.png", await fetchFile(imageBlob));
    await ffmpeg.writeFile(`track.${audioExt}`, await fetchFile(audioFile));

    const vf = buildFilter(effect, width, height, targetSeconds);
    console.log("[ffmpeg] stage 1: rendering video...", { effect, vf });

    // Stage 1: Render the video
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
      "temp.mp4",
    ]);

    console.log("[ffmpeg] stage 2: attaching thumbnail...");
    onProgress?.(0.95);

    // Stage 2: Mux the poster as the thumbnail (attached_pic)
    await ffmpeg.exec([
      "-i",
      "temp.mp4",
      "-i",
      "poster.png",
      "-map",
      "0",
      "-map",
      "1",
      "-c",
      "copy",
      "-c:v:1",
      "png",
      "-disposition:v:1",
      "attached_pic",
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
      ffmpeg.deleteFile("temp.mp4"),
      ffmpeg.deleteFile("output.mp4"),
    ]);
  }
}
