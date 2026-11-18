/** Site-wide facts shared by metadata, the sitemap, structured data and the page. */

export const SITE_URL = "https://flumechart.com";
export const SITE_NAME = "Flume";
export const SITE_TITLE = "Flume: Free Sankey chart maker for income and expenses";
export const SITE_DESCRIPTION =
  "Free Sankey chart maker for your income and expenses. Your AI agent adds up the totals and Flume draws the chart in your browser. No sign-up, no bank login.";

export interface Faq {
  question: string;
  answer: string;
}

/** Shown on the landing page and mirrored in the page's structured data. */
export const FAQS: Faq[] = [
  {
    question: "What is a Sankey chart, and why use one for a budget?",
    answer:
      "A Sankey chart draws money as ribbons whose width matches the amount. Your income sources flow in on the left, meet in one total, and fan out to spending categories and savings on the right, so the biggest shares of your budget are obvious at a glance.",
  },
  {
    question: "How do I make a Sankey chart of my income and expenses?",
    answer:
      "Copy Flume's prompt into an AI agent that can see your transactions or statements, such as ChatGPT or Claude. It replies with a short table of category totals. Paste that reply into Flume and the chart draws itself. You can then export it as a PNG.",
  },
  {
    question: "Is Flume free?",
    answer:
      "Yes. Flume is free to use. There is no account, no trial and no paid plan: drawing charts and exporting them as PNG images costs nothing.",
  },
  {
    question: "Do I have to connect my bank account?",
    answer:
      "No. Flume never asks for a bank login and has no account linking. It only needs category totals, which your agent prepares or you type in yourself.",
  },
  {
    question: "Is my financial data private?",
    answer:
      "Flume has no sign-up and no server that receives your numbers. The table you paste is read by your browser and kept only on your device, so the chart is still there after a refresh. Start over clears it.",
  },
  {
    question: "Can I use Flume without an AI agent?",
    answer:
      "Yes. Paste or drop a CSV with four columns: type, category, subcategory and amount, where type is income, expense or savings. Tables copied from a spreadsheet work too.",
  },
  {
    question: "Can I share my chart without showing the amounts?",
    answer:
      "Yes. Hide amounts replaces every figure with its percentage of income, on screen and in the exported PNG, so you can post the shape of your budget without the numbers.",
  },
];
