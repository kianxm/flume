/**
 * The prompt a user copies into their own AI agent (one that already has
 * access to their accounts or statements). The agent does the pulling and
 * the grouping; Flume only draws. The CSV format described here is the one
 * lib/flume/parse.ts accepts — change them together.
 */

export interface PromptPeriod {
  id: string;
  /** Short label for the picker. */
  label: string;
  /** How the period is described to the agent. */
  phrase: string;
}

export const PROMPT_PERIODS: PromptPeriod[] = [
  { id: "last-month", label: "Last month", phrase: "the last full calendar month" },
  { id: "last-3-months", label: "Last 3 months", phrase: "the last three full calendar months, combined into one total" },
  { id: "year-to-date", label: "Year to date", phrase: "this calendar year so far, combined into one total" },
  { id: "last-year", label: "Last year", phrase: "the last full calendar year, combined into one total" },
];

export const DEFAULT_PERIOD_ID = "last-month";

const FENCE = "```";

export function buildAgentPrompt(periodId: string = DEFAULT_PERIOD_ID): string {
  const period =
    PROMPT_PERIODS.find((p) => p.id === periodId) ?? PROMPT_PERIODS[0];

  return `I want to see where my money goes as a Sankey chart in Flume, a tool that runs entirely in my browser. Please prepare the data for it.

Period: ${period.phrase}.

What to do
1. Go through every transaction in that period across all of my accounts you can reach: checking, savings, credit cards, and investment or retirement contributions. If you can't reach my accounts, ask me to upload statements or transaction exports and work from those.
2. Sort each transaction into income, expense, or savings, then add them up by category and subcategory.
3. Reply with one CSV in a single code block, in exactly the format below. After the code block, add one short line listing anything you were unsure how to categorize. Nothing else.

Format
${FENCE}csv
# title: <short name for the period, e.g. October 2026>
# currency: <ISO code, e.g. USD>
type,category,subcategory,amount
income,Salary,,6200.00
income,Freelance,,800.00
expense,Housing,Rent,2100.00
expense,Housing,Utilities,180.00
expense,Food,Groceries,520.00
savings,Investments,401(k),600.00
${FENCE}

Rules
- type is exactly one of: income, expense, savings.
- income is money coming in. Category is the source (Salary, Freelance, Interest, Dividends). Leave subcategory empty unless one source has several distinct payers.
- expense is money spent. Category is the broad group (Housing, Food, Transport, Health, Shopping, Subscriptions, Travel). Subcategory is the specific kind (Rent, Groceries, Restaurants).
- savings is money set aside: transfers into savings accounts, investment and retirement contributions, and extra payments toward debt principal.
- amount is the total for the whole period as a plain positive number: no currency symbol, no thousands separators, two decimals.
- One row per category and subcategory pair. Add transactions up; never list them one by one. No merchant names, account numbers, or other personal details.
- Use take-home pay for income. Only if you can see my gross pay, use gross and add the withholdings as an expense category called Taxes.
- Keep it readable: 5 to 9 expense categories, at most 6 subcategories in each. Fold anything small into a subcategory called Other.
- Don't count anything twice. Ignore credit card payments (the purchases on the card are already counted) and transfers between my own spending accounts. Subtract refunds and reimbursements from the category they belong to instead of listing them as income.
- Don't force the totals to balance. If income is higher than expenses plus savings, Flume shows the rest as "Left over". If it is lower, Flume shows the gap.
- Names are short, in Title Case, and contain no commas.`;
}
