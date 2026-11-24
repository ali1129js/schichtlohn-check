import { useEffect, useState } from "react";
import { browserKV } from "@/lib/storage";
import { applyMotion, loadMotion, saveMotion, type Motion } from "@/lib/theme";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function MotionIcon({ pressed }: { pressed: boolean }) {
  if (pressed) {
    return (
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <rect x="4.5" y="4" width="4" height="12" rx="1.2" fill="currentColor" />
        <rect x="11.5" y="4" width="4" height="12" rx="1.2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M6 4.2v11.6L16.2 10 6 4.2z" fill="currentColor" />
    </svg>
  );
}

export function MotionToggle() {
  const [kv] = useState(() => browserKV());
  const [motion, setMotion] = useState<Motion>(() => loadMotion(kv));
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia(REDUCE_QUERY).matches
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(REDUCE_QUERY);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    applyMotion(document, motion, reduced);
    saveMotion(kv, motion);
  }, [kv, motion, reduced]);

  const pressed = !reduced && motion === "animated";
  const label = reduced ? "Animated background (reduced motion is on)" : "Animated background";

  return (
    <button
      type="button"
      className="icon-btn motion-toggle"
      aria-label={label}
      aria-pressed={pressed}
      disabled={reduced}
      onClick={() => setMotion(pressed ? "static" : "animated")}
    >
      <MotionIcon pressed={pressed} />
    </button>
  );
}
