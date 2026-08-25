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
        const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
        const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
        console.log("[ffmpeg] coreURL/wasmURL blobs created, loading...");
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

export interface VideoOptions {
  imageBlob: Blob;
  audioFile: File;
  duration: number;
  onProgress?: (ratio: number) => void;
}

export async function makeVideo({ imageBlob, audioFile, duration, onProgress }: VideoOptions): Promise<Blob> {
  const { fetchFile } = await import("@ffmpeg/util");
  const ffmpeg = await getFFmpeg();

  const onLog = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };
  ffmpeg.on("progress", onLog);

  const audioExt = (audioFile.name.split(".").pop() || "mp3").toLowerCase();

  try {
    await ffmpeg.writeFile("poster.png", await fetchFile(imageBlob));
    await ffmpeg.writeFile(`track.${audioExt}`, await fetchFile(audioFile));

    await ffmpeg.exec([
      "-loop", "1",
      "-i", "poster.png",
      "-i", `track.${audioExt}`,
      "-t", String(Math.max(1, Math.round(duration))),
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      "output.mp4",
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    return new Blob([bytes], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", onLog);
    await Promise.allSettled([
      ffmpeg.deleteFile("poster.png"),
      ffmpeg.deleteFile(`track.${audioExt}`),
      ffmpeg.deleteFile("output.mp4"),
    ]);
  }
}