"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { drawLogo, measureLogo } from "@/lib/brand";
import { UI_TOKENS } from "@/lib/flume/theme";
import type { ThemeName } from "@/lib/flume/types";

const SIZES = [16, 24, 32, 64, 200];
const THEMES: ThemeName[] = ["light", "dark"];
const CANVAS_SIZE = 64;

/** Scope the theme's CSS variables to one panel, so both show side by side. */
function themeVars(theme: ThemeName): CSSProperties {
  const t = UI_TOKENS[theme];
  return {
    "--bg": t.bg,
    "--surface": t.surface,
    "--text": t.text,
    "--text-muted": t.textMuted,
    "--accent": t.accent,
    "--border": t.border,
    background: t.bg,
    color: t.text,
    colorScheme: theme,
  } as CSSProperties;
}

function LogoCanvas({
  theme,
  withWordmark,
  height,
}: {
  theme: ThemeName;
  withWordmark: boolean;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { width } = measureLogo(ctx, { height, withWordmark });
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
      drawLogo(ctx, { x: 0, y: 0, height, theme, withWordmark });
    });
    return () => {
      cancelled = true;
    };
  }, [theme, withWordmark, height]);
  return <canvas ref={ref} style={{ display: "block" }} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs tracking-wide text-[var(--text-muted)] uppercase">
      {children}
    </div>
  );
}

export default function BrandDevPage() {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {THEMES.map((theme) => (
        <section key={theme} style={themeVars(theme)} className="min-w-0 space-y-10 p-8">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">{theme}</h2>

          <div>
            <Label>Mark (duo) at 16 · 24 · 32 · 64 · 200</Label>
            <div className="flex flex-wrap items-end gap-6">
              {SIZES.map((s) => (
                <LogoMark key={s} size={s} />
              ))}
            </div>
          </div>

          <div>
            <Label>Mark (mono, accent) at 16 · 24 · 32 · 64</Label>
            <div className="flex flex-wrap items-end gap-6 text-[var(--accent)]">
              {SIZES.slice(0, 4).map((s) => (
                <LogoMark key={s} size={s} variant="mono" />
              ))}
            </div>
          </div>

          <div>
            <Label>Logo at 16 · 24 · 32 · 64 · 200</Label>
            <div className="space-y-5 overflow-x-auto">
              {SIZES.map((s) => (
                <div key={s}>
                  <Logo size={s} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>SVG (top) vs canvas drawLogo (bottom) at {CANVAS_SIZE}px</Label>
            <div className="space-y-3">
              <div className="flex items-center gap-8">
                <LogoMark size={CANVAS_SIZE} />
                <Logo size={CANVAS_SIZE} />
              </div>
              <div className="flex items-center gap-8">
                <LogoCanvas theme={theme} withWordmark={false} height={CANVAS_SIZE} />
                <LogoCanvas theme={theme} withWordmark height={CANVAS_SIZE} />
              </div>
            </div>
          </div>

          <div>
            <Label>Difference: SVG over canvas (black = identical)</Label>
            <div className="relative inline-block" style={{ isolation: "isolate" }}>
              <LogoCanvas theme={theme} withWordmark height={CANVAS_SIZE} />
              <div
                className="absolute inset-0"
                style={{ mixBlendMode: "difference", lineHeight: 0 }}
              >
                <Logo size={CANVAS_SIZE} />
              </div>
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
