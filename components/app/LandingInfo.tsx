import type { ComponentType, ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { FAQS } from "@/lib/site";
import { FlowSketch } from "./FlowSketch";
import { BankOffIcon, ChevronDownIcon, ImageIcon, LockIcon, TagIcon, type IconProps } from "./icons";

const FACTS: { icon: ComponentType<IconProps>; title: string; body: ReactNode }[] = [
  { icon: TagIcon, title: "Free", body: "No account, no trial and no paid plan." },
  {
    icon: BankOffIcon,
    title: "No bank login",
    body: "Flume only needs category totals, from your agent or typed in yourself.",
  },
  {
    icon: LockIcon,
    title: "Stays on your device",
    body: "The table is read in your browser and kept only on this device.",
  },
  {
    icon: ImageIcon,
    title: "PNG export",
    body: "Landscape or portrait. Hide amounts to show percentages instead.",
  },
];

const sectionHeading =
  "text-[26px] leading-[1.12] font-semibold tracking-[-0.028em] text-balance sm:text-[32px]";

/** Plain-language explanation, the facts people ask about, and questions. */
export function LandingInfo() {
  return (
    <>
      <section
        id="about"
        aria-labelledby="about-heading"
        className="mt-16 grid scroll-mt-6 items-center gap-x-16 gap-y-10 sm:mt-24 lg:mt-0 lg:pt-24 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] xl:gap-x-20"
      >
        {/* Text comes first in the source and on phones; on wide screens the
            sketch takes the left column so it never stacks under the sample chart. */}
        <div className="min-w-0 max-w-[38rem] lg:order-2">
          <h2 id="about-heading" className={sectionHeading}>
            A Sankey chart of your income and expenses
          </h2>
          <p className="mt-5 text-[16px] leading-[1.65] text-text-muted">
            Flume is a free Sankey diagram maker for personal finance. Your AI agent adds up your income and
            spending, you paste its answer here, and Flume draws the chart right in your browser. No sign&#8209;up,
            no bank login, nothing uploaded.
          </p>
          <p className="mt-4 text-[16px] leading-[1.65] text-text-muted">
            The result is a month or a year of money as one picture: every income source on the left, every
            spending category and savings goal on the right, and what was left over.
          </p>
          <p className="mt-4 text-[16px] leading-[1.65] text-text-muted">
            No agent? A CSV with the columns type, category, subcategory and amount works just as well.
          </p>
        </div>

        <figure className="min-w-0 lg:order-1">
          <FlowSketch className="block h-auto w-full" />
          <figcaption className="mt-5 grid grid-cols-3 gap-3 pt-1 text-[13px] leading-[1.4] text-text-muted sm:text-[13.5px]">
            <span>
              <span className="block font-medium text-text">Income</span>
              Every source
            </span>
            <span className="text-center">
              <span className="block font-medium text-text">Total</span>
              Where it meets
            </span>
            <span className="text-right">
              <span className="block font-medium text-text">Spending</span>
              and savings
            </span>
          </figcaption>
        </figure>
      </section>

      <ul className="mt-16 grid gap-px overflow-hidden rounded-[20px] border border-border bg-border grid-cols-2 sm:mt-20 lg:grid-cols-4">
        {FACTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="min-w-0 bg-surface px-4 py-5 sm:px-6 sm:py-7">
            <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <Icon size={18} />
            </span>
            <p className="mt-4 text-[15.5px] leading-6 font-semibold tracking-[-0.01em]">{title}</p>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-text-muted sm:text-[14.5px]">{body}</p>
          </li>
        ))}
      </ul>

      <section
        aria-labelledby="faq-heading"
        className="mt-20 grid gap-x-16 gap-y-8 sm:mt-28 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] xl:gap-x-20"
      >
        <div className="min-w-0">
          <div className="lg:sticky lg:top-8">
            <h2 id="faq-heading" className={sectionHeading}>
              Questions
            </h2>
            <p className="mt-4 max-w-[24rem] text-[16px] leading-[1.65] text-text-muted">
              What people ask before they paste their numbers in.
            </p>
          </div>
        </div>

        <div className="faq min-w-0 max-w-[46rem] border-t border-border">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group border-b border-border">
              <summary className="-mx-3 flex min-h-11 cursor-pointer items-start justify-between gap-6 rounded-[10px] px-3 py-4 transition-colors duration-150 hover:bg-surface-2 sm:py-5">
                <h3 className="text-[16px] leading-6 font-medium tracking-[-0.01em] text-text">{faq.question}</h3>
                <span className="mt-0.5 shrink-0 text-text-faint group-open:text-text">
                  <ChevronDownIcon size={18} className="faq-chevron" />
                </span>
              </summary>
              <p className="faq-answer max-w-[38rem] pr-10 pb-6 text-[15px] leading-[1.65] text-text-muted">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <footer className="mt-24 flex flex-col gap-4 border-t border-border pt-8 sm:mt-32 sm:flex-row sm:items-center sm:justify-between">
        <Logo size={20} />
        <p className="flex items-start gap-1.5 text-[13.5px] leading-5 text-text-muted sm:items-center">
          <LockIcon size={14} className="mt-[3px] sm:mt-0" />
          Your numbers are read in your browser and never leave this device.
        </p>
      </footer>
    </>
  );
}
