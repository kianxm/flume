import { FAQS } from "@/lib/site";

/** Plain-language explanation and questions, below the two steps. */
export function LandingInfo() {
  return (
    <section
      aria-labelledby="about-heading"
      className="mt-16 border-t border-border pt-10 sm:mt-24 sm:pt-14"
    >
      <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] xl:gap-x-20">
        <div className="min-w-0">
          <h2
            id="about-heading"
            className="text-[24px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[28px]"
          >
            A Sankey chart of your income and expenses
          </h2>
          <p className="mt-4 max-w-[35rem] text-[15px] leading-[1.6] text-text-muted">
            Flume is a Sankey diagram maker for personal finance. It shows a month or a year of money as one
            picture: every income source on the left, every spending category and savings goal on the right, and
            what was left over. There is nothing to install and no account to create.
          </p>
        </div>

        <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {FAQS.map((faq) => (
            <div key={faq.question} className="min-w-0">
              <dt>
                <h3 className="text-[15px] leading-6 font-semibold tracking-[-0.01em]">{faq.question}</h3>
              </dt>
              <dd className="mt-1.5 text-[14.5px] leading-[1.55] text-text-muted">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
