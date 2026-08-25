import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./ui";

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Polling Pattern: بررسی دوره‌ای برای آپدیت‌ها در صورت باز ماندن طولانی مدت تب مرورگر
      if (r) {
        setInterval(
          () => {
            r.update().catch((err) => {
              console.error("خطا در بررسی بروزرسانی Service Worker:", err);
            });
          },
          60 * 60 * 1000, // اجرای هر ۱ ساعت (بر حسب میلی‌ثانیه)
        );
      }
    },
    onRegisterError(error) {
      console.error("خطا در ثبت Service Worker:", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="anim-toast fixed bottom-6 left-1/2 z-50 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl border border-line/50 bg-paper p-4 shadow-2xl dark:border-night-line dark:bg-night sm:bottom-10">
      <div className="mb-4 text-center text-[13.5px] font-medium leading-relaxed text-ink dark:text-night-ink">
        نسخه جدیدی از «شکسته» آماده است!
        <br />
        <span className="text-[11px] text-ink-2 dark:text-night-ink-2">
          برای اعمال تغییرات، صفحه را بروزرسانی کنید.
        </span>
      </div>
      <div className="flex justify-center gap-3">
        <Button
          variant="primary"
          onClick={() => void updateServiceWorker(true)}
          className="px-6"
        >
          بروزرسانی
        </Button>
        <Button onClick={() => setNeedRefresh(false)} className="px-6">
          بعداً
        </Button>
      </div>
    </div>
  );
}
