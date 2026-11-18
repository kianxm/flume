"use client";

import { Logo } from "@/components/brand/Logo";
import { useTheme } from "@/lib/use-theme";
import { MoonIcon, SunIcon } from "./icons";
import { Button, IconButton } from "./ui";

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton
      // The icons switch through CSS, so the right one is there before
      // hydration; only the label waits for the hook.
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className="-mr-2.5"
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </IconButton>
  );
}

export interface HeaderProps {
  /** Present only while a chart is loaded. */
  onStartOver?: () => void;
}

export function Header({ onStartOver }: HeaderProps) {
  return (
    <header className="page-x pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 w-full max-w-[1360px] items-center justify-between sm:h-[72px]">
        <Logo size={22} />
        <div className="flex items-center gap-1">
          {onStartOver && (
            <Button variant="ghost" size="sm" onClick={onStartOver}>
              Start over
            </Button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
