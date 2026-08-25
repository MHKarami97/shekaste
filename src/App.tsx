import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Controls from "./components/Controls";
import GanjoorBrowser, { type Insertion } from "./components/GanjoorBrowser";
import Preview from "./components/Preview";
import { Button } from "./components/ui";
import { loadChromeFonts, loadFont } from "./lib/fonts";
import { FORMAT_BY_ID } from "./lib/formats";
import {
  fitFontSize,
  INITIAL,
  parseStanzas,
  toFa,
  type PoemState,
} from "./lib/poem";
import { encodeState, readHash, shareUrl } from "./lib/share";
import { copyPng, exportPng, sharePng } from "./lib/export";
import { bumpCounter, readCounter, type CounterState } from "./lib/counter";
import { BRAND } from "./lib/brand";
import { Ltr, Mark, SoonTag, Wordmark } from "./components/Wordmark";
import { applyTheme, getInitialTheme, type Theme } from "./lib/theme";

const DRAFT_KEY = "shekaste:draft";

const loadDraft = (): PoemState => {
  const shared = readHash();
  if (shared) return shared;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...INITIAL, ...JSON.parse(raw) };
  } catch {}
  return INITIAL;
};

type Toast = { text: string; tone: "ok" | "err" } | null;

export default function App() {
  const [state, setState] = useState<PoemState>(loadDraft);
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [browsing, setBrowsing] = useState(false);
  const [counter, setCounter] = useState<CounterState>({
    global: null,
    local: 0,
  });
  const pageRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const patch = useCallback(
    (p: Partial<PoemState>) => setState((s) => ({ ...s, ...p })),
    [],
  );

  const autoFit = useCallback(
    () =>
      setState((s) => {
        const stanzas = parseStanzas(s.text);
        const lines = stanzas.reduce((n, st) => n + st.lines.length, 0);
        return { ...s, fontSize: fitFontSize(s, lines, stanzas.length) };
      }),
    [],
  );

  const format = FORMAT_BY_ID.get(state.formatId)!;

  const made =
    counter.global !== null
      ? `${toFa(counter.global.toLocaleString("en-US"))} صفحه ساخته شده`
      : counter.local > 0
        ? `${toFa(counter.local)} صفحه در این مرورگر`
        : "";

  useEffect(() => {
    void loadFont(state.fontId);
  }, [state.fontId]);

  useEffect(() => {
    setState((s) => {
      const stanzas = parseStanzas(s.text);
      const lines = stanzas.reduce((n, st) => n + st.lines.length, 0);
      const fit = fitFontSize(s, lines, stanzas.length);
      return s.fontSize > fit ? { ...s, fontSize: fit } : s;
    });
  }, [
    state.fontId,
    state.formatId,
    state.text,
    state.padding,
    state.lineHeight,
    state.beitGap,
    state.title,
    state.poet,
    state.source,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    void readCounter().then(setCounter);
    void loadChromeFonts();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      history.replaceState(null, "", `#p=${encodeState(state)}`);
    }, 400);
    return () => clearTimeout(id);
  }, [state]);

  useEffect(() => {
    const onHash = () => {
      const shared = readHash();
      if (shared) setState(shared);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const exportOpts = useMemo(
    () => ({
      scale,
      width: format.w,
      height: format.h,
      filename: `${(state.title || state.poet || "shekaste").replace(/[\\/:*?"<>|]/g, "")}-${format.id}.png`,
    }),
    [scale, format, state.title, state.poet],
  );

  const withPage = async (
    name: string,
    fn: (node: HTMLElement) => Promise<void>,
  ) => {
    const node = pageRef.current;
    if (!node) return;
    setBusy(name);
    try {
      await loadFont(state.fontId);
      await fn(node);
    } catch (err) {
      console.error(err);
      setToast({
        text: "ساخت تصویر ناموفق بود. دوباره تلاش کنید.",
        tone: "err",
      });
    } finally {
      setBusy(null);
    }
  };

  const onDownload = () =>
    withPage("download", async (node) => {
      await exportPng(node, exportOpts);
      setToast({ text: "تصویر ذخیره شد.", tone: "ok" });
      setCounter(await bumpCounter());
    });

  const onShare = () =>
    withPage("share", async (node) => {
      const shared = await sharePng(
        node,
        exportOpts,
        `${state.title} — ${state.poet}`,
      );
      if (!shared) {
        await exportPng(node, exportOpts);
        setToast({
          text: "اشتراک‌گذاری پشتیبانی نشد؛ تصویر دانلود شد.",
          tone: "ok",
        });
      }
      setCounter(await bumpCounter());
    });

  const onCopy = () =>
    withPage("copy", async (node) => {
      await copyPng(node, exportOpts);
      setToast({ text: "تصویر در کلیپ‌بورد کپی شد.", tone: "ok" });
    });

  const onCopyLink = async () => {
    const url = shareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      setToast({
        text: `پیوند کپی شد (${toFa(url.length)} نویسه).`,
        tone: "ok",
      });
    } catch {
      setToast({ text: "کپی پیوند ناموفق بود.", tone: "err" });
    }
  };

  const onReset = () => {
    if (!confirm("همه‌چیز به حالت اولیه برگردد؟")) return;
    setState(INITIAL);
  };

  return (
    <div className="flex h-full flex-col bg-paper text-ink dark:bg-night dark:text-night-ink">
      <header className="anim-fade z-30 flex shrink-0 items-center justify-between gap-2 border-b border-line/50 bg-paper/90 px-3 py-2.5 backdrop-blur-md sm:px-4 dark:border-night-line dark:bg-night/90">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <Mark className="h-8 w-8 sm:h-9 sm:w-9" />
            <Wordmark className="h-7 sm:h-8" />
            <span className="h-4 w-px shrink-0 bg-line dark:bg-night-line" />
          </span>

          <SoonTag className="hidden sm:inline-flex" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {made && (
            <span className="hidden text-[11px] text-ink-2 lg:inline dark:text-night-ink-2">
              {made}
            </span>
          )}
          <Button onClick={onCopyLink} className="hidden sm:inline-flex">
            لینک
          </Button>

          <Button
            variant="primary"
            onClick={onDownload}
            disabled={busy !== null}
          >
            {busy === "download" ? (
              <span className="anim-breathe">در حال ساخت…</span>
            ) : (
              "دانلود"
            )}
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-0 shrink-0 basis-[38vh] bg-paper-2/40 sm:basis-[44vh] lg:order-2 lg:basis-auto lg:flex-1 lg:bg-transparent dark:bg-night-2/30 lg:dark:bg-transparent">
          <div className="anim-fade absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(176,125,98,0.12),transparent_65%)]" />
          <Preview state={state} pageRef={pageRef} />
        </section>

        <aside className="min-h-0 w-full overflow-y-auto border-line/50 bg-paper p-3 lg:order-1 lg:w-98 lg:shrink-0 lg:border-l dark:border-night-line dark:bg-night">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 lg:max-w-none">
            <Controls
              state={state}
              patch={patch}
              onBrowse={() => setBrowsing(true)}
              onAutoFit={autoFit}
              scale={scale}
              setScale={setScale}
            />

            <section
              className="anim-rise jadval rounded-2xl bg-white/45 p-4 dark:bg-night-2/70"
              style={{ "--anim-delay": "240ms" } as React.CSSProperties}
            >
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={onShare} disabled={busy !== null}>
                  {busy === "share" ? "…" : "اشتراک"}
                </Button>

                <Button onClick={onCopy} disabled={busy !== null}>
                  {busy === "copy" ? "…" : "کپی تصویر"}
                </Button>

                <Button onClick={onCopyLink} className="sm:hidden">
                  کپی پیوند
                </Button>

                <Button onClick={onReset} className="sm:col-span-2">
                  ریست
                </Button>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-ink-2/85 dark:text-night-ink-2"></p>

              {made && (
                <p className="mt-2 text-[11px] text-ink-2/70 lg:hidden dark:text-night-ink-2">
                  {made}
                </p>
              )}
            </section>

            <section
              className="anim-rise jadval rounded-2xl bg-tan/8 p-4"
              style={{ "--anim-delay": "280ms" } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <Wordmark className="h-10" />
                <SoonTag />
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-ink-2 dark:text-night-ink-2">
                {BRAND.faPitch}
              </p>

              <p className="mt-3">
                <Ltr className="font-mark text-[13.5px] text-tan">
                  <a href="https://mhkarami97.ir">{BRAND.enTeaser}</a>
                </Ltr>
              </p>

              <div className="mt-3 text-right">
                <button
                  type="button"
                  onClick={() =>
                    setTheme((t) => (t === "dark" ? "light" : "dark"))
                  }
                  title={theme === "dark" ? "حالت روشن" : "حالت تاریک"}
                  className="inline-flex items-center gap-2 rounded-xl border border-line/60 bg-paper/70 px-3 py-2 text-12px text-ink-2 transition hover:border-tan/60 dark:border-night-line dark:bg-night/60 dark:text-night-ink-2"
                >
                  {theme === "dark" ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      aria-hidden
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="4.2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  <span>{theme === "dark" ? "روشن" : "تاریک"}</span>
                </button>
              </div>
            </section>
          </div>
        </aside>
      </main>

      {browsing && (
        <GanjoorBrowser
          onClose={() => setBrowsing(false)}
          onInsert={(v: Insertion) => {
            setState((s) => {
              const next = { ...s, ...v };
              const stanzas = parseStanzas(next.text);
              const lines = stanzas.reduce((n, st) => n + st.lines.length, 0);
              return {
                ...next,
                fontSize: fitFontSize(next, lines, stanzas.length),
              };
            });
            setBrowsing(false);
            setToast({ text: `«${v.title}» درج شد.`, tone: "ok" });
          }}
        />
      )}

      {toast && (
        <div
          className={`anim-toast fixed bottom-5 left-1/2 z-50 rounded-xl px-4 py-2.5 text-[13px] shadow-lg ${
            toast.tone === "ok"
              ? "bg-ink text-paper"
              : "bg-[#8c2f2f] text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
