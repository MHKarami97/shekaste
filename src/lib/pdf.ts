import { jsPDF } from "jspdf";
import { capturePng, type ExportOptions } from "./export";

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function exportPdf(
  node: HTMLElement,
  opts: ExportOptions,
  filename?: string,
): Promise<void> {
  const blob = await capturePng(node, opts);
  const dataUrl = await blobToDataURL(blob);

  const pdf = new jsPDF({
    unit: "px",
    format: [opts.width, opts.height],
    orientation: opts.width >= opts.height ? "landscape" : "portrait",
  });

  pdf.addImage(dataUrl, "PNG", 0, 0, opts.width, opts.height);
  pdf.save(filename ?? opts.filename.replace(/\.png$/i, ".pdf"));
}
