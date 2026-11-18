import { describe, expect, it } from "vitest";
import { parseAmount, parseFlumeInput } from "./parse";
import { SAMPLE_CSV } from "./sample";
import { buildAgentPrompt } from "./prompt";
import type { FlowRow, FlumeData } from "./types";

/** Parse, assert it produced data, and return it. */
function ok(text: string): FlumeData {
  const r = parseFlumeInput(text);
  expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  expect(r.data).not.toBeNull();
  return r.data as FlumeData;
}

const row = (
  type: FlowRow["type"],
  category: string,
  subcategory: string | undefined,
  amount: number,
): FlowRow => ({ type, category, ...(subcategory ? { subcategory } : {}), amount });

describe("canonical input", () => {
  it("parses SAMPLE_CSV with zero issues", () => {
    const r = parseFlumeInput(SAMPLE_CSV);
    expect(r.issues).toEqual([]);
    expect(r.data?.title).toBe("October 2026");
    expect(r.data?.currency).toBe("USD");
    expect(r.data?.rows).toHaveLength(24);
    expect(r.data?.rows[0]).toEqual(row("income", "Salary", undefined, 6480));
    expect(r.data?.rows[3]).toEqual(row("expense", "Housing", "Rent", 2150));
  });

  it("parses the example shown in the agent prompt with zero issues", () => {
    const prompt = buildAgentPrompt();
    const block = /```csv\n([\s\S]*?)```/.exec(prompt)?.[1] ?? "";
    const r = parseFlumeInput(block);
    expect(r.issues).toEqual([]);
    expect(r.data?.rows).toHaveLength(6);
  });

  it("reads a minimal file", () => {
    const d = ok("type,category,subcategory,amount\nincome,Salary,,6200.00\nexpense,Housing,Rent,2100.00\nsavings,Investments,401(k),600.00");
    expect(d.currency).toBe("USD");
    expect(d.title).toBeUndefined();
    expect(d.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
      row("savings", "Investments", "401(k)", 600),
    ]);
  });
});

describe("pasted chat replies", () => {
  it("finds the data inside prose, a fence and a trailing note", () => {
    const reply = `Sure! I went through your October transactions across checking, your credit card and your brokerage account. Here is the CSV you asked for:

\`\`\`csv
# title: October 2026
# currency: USD
type,category,subcategory,amount
income,Salary,,6200.00
income,Freelance,,800.00
expense,Housing,Rent,2100.00
expense,Housing,Utilities,180.00
expense,Food,Groceries,520.00
savings,Investments,401(k),600.00
\`\`\`

I wasn't sure whether the $64.99 charge from "Acme, Inc." was a subscription or shopping, so I put it under Shopping. Let me know if you'd like me to change anything!`;
    const r = parseFlumeInput(reply);
    expect(r.issues).toEqual([]);
    expect(r.data?.title).toBe("October 2026");
    expect(r.data?.rows).toHaveLength(6);
  });

  it("handles fences without a language and with tildes", () => {
    for (const fence of ["```", "```text", "~~~", "```CSV"]) {
      const d = ok(`Here you go\n${fence}\ntype,category,subcategory,amount\nincome,Salary,,100\nexpense,Food,,40\n${fence}\nEnjoy.`);
      expect(d.rows).toHaveLength(2);
    }
  });

  it("copes with prose that contains commas and numbers", () => {
    const d = ok(`Based on your statements, groceries, dining, and coffee were the biggest items, roughly 30% of spending.\n\ntype,category,subcategory,amount\nincome,Salary,,3000\nexpense,Food,Groceries,400\n\nNote: some items, like gifts, might be miscategorised, sorry.`);
    expect(d.rows).toHaveLength(2);
  });

  it("ignores a second summary table after the data", () => {
    const d = ok(`type,category,subcategory,amount
income,Salary,,3000
expense,Food,Groceries,400
expense,Rent,,1200

| Category | Amount | Share |
|---|---|---|
| Food | $400 | 25% |
| Rent | $1,200 | 75% |`);
    expect(d.rows).toHaveLength(3);
  });

  it("strips list bullets and numbering a chat window may add", () => {
    const d = ok(`- income,Salary,,3000\n- expense,Food,Groceries,400\n1. savings,Emergency fund,,100`);
    expect(d.rows).toHaveLength(3);
  });

  it("handles markdown bold in metadata", () => {
    const d = ok(`**Title:** March 2026\n**Currency:** EUR\n\ntype,category,subcategory,amount\nincome,Salary,,3000`);
    expect(d.title).toBe("March 2026");
    expect(d.currency).toBe("EUR");
  });
});

describe("delimiters", () => {
  it("reads a tab-separated spreadsheet paste, metadata as first cells", () => {
    const tsv = [
      "# title: October 2026\t\t\t",
      "currency\tGBP\t\t",
      "type\tcategory\tsubcategory\tamount",
      "income\tSalary\t\t£4,200.00",
      "expense\tHousing\tRent\t£1,350.00",
      "expense\tFood\tEating out, drinks\t£212.40",
      "savings\tISA\t\t£500.00",
    ].join("\n");
    const r = parseFlumeInput(tsv);
    expect(r.issues).toEqual([]);
    expect(r.data?.title).toBe("October 2026");
    expect(r.data?.currency).toBe("GBP");
    expect(r.data?.rows).toEqual([
      row("income", "Salary", undefined, 4200),
      row("expense", "Housing", "Rent", 1350),
      row("expense", "Food", "Eating out, drinks", 212.4),
      row("savings", "ISA", undefined, 500),
    ]);
  });

  it("reads a semicolon file", () => {
    const d = ok("type;category;subcategory;amount\nincome;Salary;;6200,50\nexpense;Housing;Rent;2100,00");
    expect(d.rows.map((r) => r.amount)).toEqual([6200.5, 2100]);
  });

  it("reads a Markdown table, including bold headers and a separator row", () => {
    const md = `Here is your summary:

| **Type** | **Category** | **Subcategory** | **Amount** |
|:---------|:-------------|-----------------|-----------:|
| income   | Salary       |                 | $6,200.00  |
| expense  | Housing      | Rent            | $2,100.00  |
| expense  | Food         | Groceries       | $520.50    |
| savings  | Investments  | 401(k)          | $600.00    |

Hope that helps!`;
    const r = parseFlumeInput(md);
    expect(r.issues).toEqual([]);
    expect(r.data?.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
      row("expense", "Food", "Groceries", 520.5),
      row("savings", "Investments", "401(k)", 600),
    ]);
    expect(r.data?.currency).toBe("USD");
  });

  it("reads a Markdown table without outer pipes", () => {
    const d = ok("type | category | amount\n--- | --- | ---\nincome | Salary | 100\nexpense | Food | 40");
    expect(d.rows).toHaveLength(2);
  });

  it("reads a plain-text table aligned with spaces", () => {
    const d = ok("type      category    subcategory   amount\nincome    Salary                    6200.00\nexpense   Housing     Rent          2100.00\nexpense   Food        Groceries     320.00");
    expect(d.rows.map((r) => r.amount)).toEqual([6200, 2100, 320]);
  });

  it("reads quoted fields with embedded commas and escaped quotes", () => {
    const d = ok(`type,category,subcategory,amount
income,"Salary, Acme Inc.",,"6,200.00"
expense,Food,"Eating out, ""fancy"" places",120.00
expense,"Kids' stuff","Toys & games",45`);
    expect(d.rows[0].category).toBe("Salary, Acme Inc.");
    expect(d.rows[0].amount).toBe(6200);
    expect(d.rows[1].subcategory).toBe('Eating out, "fancy" places');
    expect(d.rows[2].category).toBe("Kids' stuff");
  });

  it("reads a European-formatted file", () => {
    const text = `# title: Oktober 2026
# currency: EUR
type;category;subcategory;amount
income;Gehalt;;"3.450,00"
income;Zinsen;;12,34
expense;Wohnen;Miete;"1.100,00"
expense;Wohnen;Strom;89,90
expense;Essen;Lebensmittel;"1 234,56"
savings;Sparen;ETF;300,00`;
    const r = parseFlumeInput(text);
    expect(r.issues).toEqual([]);
    expect(r.data?.currency).toBe("EUR");
    expect(r.data?.rows.map((x) => x.amount)).toEqual([3450, 12.34, 1100, 89.9, 1234.56, 300]);
  });

  it("repairs unquoted amounts that were split on their thousands comma", () => {
    const d = ok("type,category,subcategory,amount\nincome,Salary,,6,200.00\nexpense,Housing,Rent,2,100.50\nexpense,Big,Thing,1,234,567.00");
    expect(d.rows.map((r) => r.amount)).toEqual([6200, 2100.5, 1234567]);
  });
});

describe("file hygiene", () => {
  it("handles BOM, CRLF, blank lines, trailing delimiters and extra spaces", () => {
    const text = "﻿# title: May\r\n\r\n  type , category , subcategory , amount ,\r\n\r\nincome , Salary ,, 6200.00 ,\r\nexpense,Housing,Rent,2100.00,,\r\n\r\n";
    const r = parseFlumeInput(text);
    expect(r.issues).toEqual([]);
    expect(r.data?.title).toBe("May");
    expect(r.data?.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
    ]);
  });

  it("handles old Mac (CR only) line endings", () => {
    const d = ok("type,category,subcategory,amount\rincome,Salary,,100\rexpense,Food,,40");
    expect(d.rows).toHaveLength(2);
  });

  it("handles non-breaking spaces, smart quotes and HTML ampersands from a chat window", () => {
    const d = ok("type,category,subcategory,amount\nincome,Salary,, 6 200,00\nexpense,“Food, drink”,Cafes &amp; bars,12.50");
    expect(d.rows[0].amount).toBe(6200);
    expect(d.rows[1].category).toBe("Food, drink");
    expect(d.rows[1].subcategory).toBe("Cafes & bars");
  });
});

describe("headers", () => {
  it("infers four columns by position when there is no header", () => {
    const d = ok("income,Salary,,6200.00\nexpense,Housing,Rent,2100.00\nsavings,Investments,401(k),600.00");
    expect(d.rows).toHaveLength(3);
    expect(d.rows[1]).toEqual(row("expense", "Housing", "Rent", 2100));
  });

  it("handles a headerless three-column file", () => {
    const d = ok("income,Salary,6200\nexpense,Housing,2100\nexpense,Food,520");
    expect(d.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", undefined, 2100),
      row("expense", "Food", undefined, 520),
    ]);
  });

  it("handles a three-column file with a header and no subcategory column", () => {
    const d = ok("Type,Category,Amount\nIncome,Salary,6200\nExpense,Housing,2100");
    expect(d.rows).toHaveLength(2);
    expect(d.rows[1].subcategory).toBeUndefined();
  });

  it("handles columns in a different order", () => {
    const d = ok("amount,subcategory,category,type\n6200,,Salary,income\n2100,Rent,Housing,expense");
    expect(d.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
    ]);
  });

  it("handles headerless columns in a different order", () => {
    const d = ok("Salary,income,6200\nHousing,expense,2100\nFood,expense,520");
    expect(d.rows.map((r) => `${r.type}:${r.category}:${r.amount}`)).toEqual([
      "income:Salary:6200",
      "expense:Housing:2100",
      "expense:Food:520",
    ]);
  });

  it.each([
    ["Type,Category,Sub-category,Amount"],
    ["TYPE,CATEGORY,SUB CATEGORY,TOTAL"],
    ["kind,group,subcat,value"],
    ["Flow,Main Category,Sub_Category,Amount (USD)"],
    ["type,category,subcategory,Amount ($)"],
    ["Type,Category,Subcategory,Total Amount"],
  ])("recognises the header %s", (header) => {
    const d = ok(`${header}\nincome,Salary,,6200\nexpense,Housing,Rent,2100`);
    expect(d.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
    ]);
  });

  it("reads group/name/total as category/subcategory/amount", () => {
    const d = ok("type,group,name,total\nexpense,Housing,Rent,2100\nincome,Job,,5000");
    expect(d.rows[0]).toEqual(row("expense", "Housing", "Rent", 2100));
  });

  it("reads name/amount as category/amount", () => {
    const d = ok("type,name,amount\nexpense,Housing,2100\nincome,Job,5000");
    expect(d.rows[0]).toEqual(row("expense", "Housing", undefined, 2100));
  });

  it("ignores extra columns such as a note or a percent", () => {
    const d = ok("type,category,subcategory,amount,share,notes\nincome,Salary,,6200,100%,paycheck\nexpense,Housing,Rent,2100,34%,\nexpense,Food,,300,5%,groceries mostly");
    expect(d.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
      row("expense", "Food", undefined, 300),
    ]);
  });

  it("copes with rows that drop the empty subcategory field entirely", () => {
    const r = parseFlumeInput("type,category,subcategory,amount\nincome,Salary,6200\nexpense,Housing,Rent,2100\nexpense,Food,520.00");
    expect(r.issues).toEqual([]);
    expect(r.data?.rows).toEqual([
      row("income", "Salary", undefined, 6200),
      row("expense", "Housing", "Rent", 2100),
      row("expense", "Food", undefined, 520),
    ]);
  });

  it("skips a repeated header row", () => {
    const d = ok("type,category,subcategory,amount\nincome,Salary,,100\ntype,category,subcategory,amount\nexpense,Food,,40");
    expect(d.rows).toHaveLength(2);
  });
});

describe("type words", () => {
  it.each([
    ["Income", "income"], ["INCOME", "income"], ["incomes", "income"], ["Revenue", "income"], ["earnings", "income"],
    ["expense", "expense"], ["Expenses", "expense"], ["spending", "expense"], ["Spending:", "expense"], ["Outflow", "expense"],
    ["saving", "savings"], ["Savings", "savings"], ["savings/investments", "savings"], ["Investment", "savings"], ["investments", "savings"],
  ])("maps %s to %s", (word, type) => {
    const d = ok(`type,category,subcategory,amount\n${word},Thing,,10\nincome,Pay,,10`);
    expect(d.rows[0].type).toBe(type);
  });
});

describe("amounts", () => {
  it.each([
    ["1234.56", 1234.56],
    ["$1,234.56", 1234.56],
    ["1,234.56", 1234.56],
    ["1 234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1.234,56", 1234.56],
    ["1'234.56", 1234.56],
    ["€50", 50],
    ["50 €", 50],
    ["£1,000", 1000],
    ["1,234", 1234],
    ["1.234", 1234],
    ["12,5", 12.5],
    ["12,50", 12.5],
    ["0,125", 0.13],
    ["1,234,567", 1234567],
    ["USD 100", 100],
    ["100 USD", 100],
    ["50 eur", 50],
    ["$ 75", 75],
    ["**$75.00**", 75],
    ["~$500", 500],
    ["+25", 25],
    ["'6200", 6200],
    ["100.", 100],
  ])("reads %s as %s", (text, value) => {
    const a = parseAmount(text);
    expect(a?.value).toBe(value);
    expect(a?.negative).toBe(false);
  });

  it.each([["(120.00)"], ["-120"], ["$-120"], ["-$120"], ["120-"], ["−120"], ["($120.00)"]])(
    "reads %s as negative 120",
    (text) => {
      const a = parseAmount(text);
      expect(a?.value).toBe(120);
      expect(a?.negative).toBe(true);
    },
  );

  it.each([[""], ["abc"], ["12 34"], ["1.2.3"], ["50 apples"], ["n/a"], ["31%"], ["2026-10-01"], ["--"]])(
    "does not read %j as an amount",
    (text) => {
      expect(parseAmount(text)).toBeNull();
    },
  );

  it("takes the absolute value of negative amounts and says so", () => {
    const r = parseFlumeInput("type,category,subcategory,amount\nincome,Salary,,6200\nexpense,Food,Groceries,(120.00)\nexpense,Gas,,-45");
    expect(r.data?.rows.map((x) => x.amount)).toEqual([6200, 120, 45]);
    const w = r.issues.filter((i) => i.level === "warning");
    expect(w).toHaveLength(2);
    expect(w[0].line).toBe(3);
    expect(w[0].message).toMatch(/negative/);
    expect(w[0].message).toMatch(/Food > Groceries/);
    expect(w[1].line).toBe(4);
  });
});

describe("currency", () => {
  const body = "type,category,subcategory,amount\nincome,Salary,,100\nexpense,Food,,40";
  it("defaults to USD", () => {
    expect(ok(body).currency).toBe("USD");
  });
  it("reads the currency line in any case, with or without #", () => {
    for (const line of ["# currency: eur", "currency: EUR", "CURRENCY = EUR", "# Currency: EUR (€)", "#currency:EUR", "currency: Euro", "currency: €"]) {
      expect(ok(`${line}\n${body}`).currency).toBe("EUR");
    }
  });
  it("reads a currency declared in a spreadsheet cell", () => {
    expect(ok(`currency,CAD,,\n${body}`).currency).toBe("CAD");
    expect(ok(`# currency: CHF,,,\n${body}`).currency).toBe("CHF");
  });
  it("infers the currency from symbols and codes when no line says", () => {
    expect(ok("type,category,amount\nincome,Salary,€3000\nexpense,Rent,€1000").currency).toBe("EUR");
    expect(ok("type,category,amount\nincome,Salary,£3000\nexpense,Rent,£1000").currency).toBe("GBP");
    expect(ok("type,category,amount\nincome,Salary,3000 SEK\nexpense,Rent,1000 SEK").currency).toBe("SEK");
    expect(ok("type,category,amount\nincome,Salary,₹300000\nexpense,Rent,₹10000").currency).toBe("INR");
    expect(ok("type,category,amount (EUR)\nincome,Salary,3000\nexpense,Rent,1000").currency).toBe("EUR");
  });
  it("lets the currency line win and does not complain about a bare $ under CAD", () => {
    const r = parseFlumeInput("# currency: CAD\ntype,category,amount\nincome,Salary,$3000\nexpense,Rent,$1000");
    expect(r.data?.currency).toBe("CAD");
    expect(r.issues).toEqual([]);
  });
  it("warns when the amounts clearly use another currency than the currency line", () => {
    const r = parseFlumeInput("# currency: USD\ntype,category,amount\nincome,Salary,€3000\nexpense,Rent,€1000");
    expect(r.data?.currency).toBe("USD");
    expect(r.issues[0].message).toMatch(/EUR/);
  });
  it("warns about an unreadable currency line and falls back to the amounts", () => {
    const r = parseFlumeInput("# currency: sparkles\ntype,category,amount\nincome,Salary,€3000\nexpense,Rent,€1000");
    expect(r.data?.currency).toBe("EUR");
    expect(r.issues.some((i) => /sparkles/.test(i.message))).toBe(true);
  });
  it("warns when amounts mix currencies", () => {
    const r = parseFlumeInput("type,category,amount\nincome,Salary,€3000\nincome,Side,€200\nexpense,Rent,$1000");
    expect(r.data?.currency).toBe("EUR");
    expect(r.issues.some((i) => /more than one currency/.test(i.message))).toBe(true);
  });
});

describe("metadata", () => {
  const body = "type,category,subcategory,amount\nincome,Salary,,100\nexpense,Food,,40";
  it("reads the title in any case, with or without #", () => {
    for (const line of ["# title: Q3 2026", "title: Q3 2026", "TITLE = Q3 2026", "#Title:Q3 2026", "# title: \"Q3 2026\"", "# title: Q3 2026,,,", "Period: Q3 2026"]) {
      expect(ok(`${line}\n${body}`).title).toBe("Q3 2026");
    }
  });
  it("reads a title from the first cells of a row", () => {
    expect(ok(`title,Q3 2026,,\n${body}`).title).toBe("Q3 2026");
    expect(ok(`# title\tQ3 2026\n${body.replace(/,/g, "\t")}`).title).toBe("Q3 2026");
  });
  it("keeps a comma inside the title", () => {
    expect(ok(`# title: Q3, 2026\n${body}`).title).toBe("Q3, 2026");
  });
  it("ignores other comment lines and markdown headings", () => {
    const r = parseFlumeInput(`## Your data\n# generated by robots\n// notes\n${body}`);
    expect(r.issues).toEqual([]);
    expect(r.data?.rows).toHaveLength(2);
  });
});

describe("names", () => {
  it("sums duplicate rows case-insensitively and says so", () => {
    const r = parseFlumeInput(`type,category,subcategory,amount
income,Salary,,3000
expense,Food,Groceries,100.10
expense,food,groceries,50.20
expense,Food,Groceries,0.05`);
    expect(r.data?.rows).toEqual([
      row("income", "Salary", undefined, 3000),
      row("expense", "Food", "Groceries", 150.35),
    ]);
    const w = r.issues.filter((i) => i.level === "warning");
    expect(w).toHaveLength(2);
    expect(w[0].line).toBe(4);
    expect(w[0].message).toMatch(/line 3/);
  });

  it("does not merge the same name under different types", () => {
    const d = ok("type,category,subcategory,amount\nexpense,Investments,,100\nsavings,Investments,,200\nincome,Salary,,1000");
    expect(d.rows).toHaveLength(3);
  });

  it.each([["-"], ["–"], ["—"], ["n/a"], ["N/A"], ["none"], ["None"], ["null"], ["(none)"], ["  "], ["Rent"]])(
    "treats subcategory %j correctly",
    (sub) => {
      const d = ok(`type,category,subcategory,amount\nincome,Salary,,1000\nexpense,Rent,${sub},100`);
      expect(d.rows[1].subcategory).toBeUndefined();
    },
  );

  it("treats a subcategory equal to its category, in any case, as none", () => {
    const d = ok("type,category,subcategory,amount\nincome,Salary,salary,1000\nexpense,Food,Groceries,100");
    expect(d.rows[0].subcategory).toBeUndefined();
    expect(d.rows[1].subcategory).toBe("Groceries");
  });

  it("splits 'Category > Subcategory' when there is no subcategory column", () => {
    const d = ok("type,category,amount\nincome,Salary,1000\nexpense,Housing > Rent,100\nexpense,Food / Drink,20");
    expect(d.rows[1]).toEqual(row("expense", "Housing", "Rent", 100));
    expect(d.rows[2].category).toBe("Food / Drink");
  });

  it("uses the subcategory as the category when the category is blank, and files nameless rows under Other", () => {
    const r = parseFlumeInput("type,category,subcategory,amount\nincome,Salary,,1000\nexpense,,Rent,100\nexpense,,,50");
    expect(r.data?.rows[1]).toEqual(row("expense", "Rent", undefined, 100));
    expect(r.data?.rows[2]).toEqual(row("expense", "Other", undefined, 50));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].line).toBe(4);
  });

  it("joins extra unquoted comma pieces onto the subcategory with a warning", () => {
    const r = parseFlumeInput("type,category,subcategory,amount\nincome,Salary,,1000\nexpense,Food,Eating out, drinks,50");
    expect(r.data?.rows[1]).toEqual(row("expense", "Food", "Eating out, drinks", 50));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].line).toBe(3);
    expect(r.issues[0].message).toMatch(/quotes/);
  });
});

describe("rows that cannot be used", () => {
  it("skips zero, blank and unreadable amounts, naming each line", () => {
    const r = parseFlumeInput(`type,category,subcategory,amount
income,Salary,,3000
expense,Food,Groceries,0
expense,Food,Coffee,abc
expense,Food,Snacks,
expense,Rent,,1000
expense,Gym,,"n/a"`);
    expect(r.data?.rows).toHaveLength(2);
    const w = r.issues.filter((i) => i.level === "warning");
    expect(w.map((x) => x.line)).toEqual([3, 4, 5, 7]);
    expect(w[0].message).toMatch(/zero/);
    expect(w[1].message).toMatch(/"abc"/);
    expect(w[2].message).toMatch(/no amount/);
    for (const x of w) expect(x.message).toMatch(/skipped/);
  });

  it("skips rows with an unknown type that sit inside the data, naming the line", () => {
    const r = parseFlumeInput(`type,category,subcategory,amount
income,Salary,,3000
transfer,Credit card payment,,500
expense,Rent,,1000
Total,,,4000
expense,Food,,200`);
    expect(r.data?.rows).toHaveLength(3);
    const w = r.issues.filter((i) => i.level === "warning");
    expect(w.map((x) => x.line)).toEqual([3, 5]);
    expect(w[0].message).toMatch(/"transfer"/);
    expect(w[0].message).toMatch(/income, expense or savings/);
  });

  it("caps the number of warnings and summarises the rest", () => {
    const lines = ["type,category,subcategory,amount", "income,Salary,,100"];
    for (let i = 0; i < 60; i++) lines.push(`expense,Item ${i},,oops`);
    const r = parseFlumeInput(lines.join("\n"));
    expect(r.data?.rows).toHaveLength(1);
    expect(r.issues.length).toBeLessThan(25);
    expect(r.issues[r.issues.length - 1].message).toMatch(/more lines/);
  });

  it("warns when there is income but no spending, and the reverse", () => {
    const a = parseFlumeInput("type,category,amount\nincome,Salary,100");
    expect(a.data).not.toBeNull();
    expect(a.issues).toHaveLength(1);
    expect(a.issues[0].message).toMatch(/no expense or savings/);
    const b = parseFlumeInput("type,category,amount\nexpense,Rent,100");
    expect(b.data).not.toBeNull();
    expect(b.issues[0].message).toMatch(/no income/);
  });
});

describe("errors", () => {
  const firstError = (text: string) => {
    const r = parseFlumeInput(text);
    expect(r.data).toBeNull();
    const e = r.issues.filter((i) => i.level === "error");
    expect(e.length).toBeGreaterThanOrEqual(1);
    return e[0];
  };

  it("rejects empty and whitespace-only input", () => {
    expect(firstError("").message).toMatch(/Paste/);
    expect(firstError("  \n\t \r\n").message).toMatch(/Paste/);
  });

  it("rejects prose with no table, saying what the format is", () => {
    const e = firstError("I'm sorry, but I can't access your bank accounts. Could you upload your statements instead?");
    expect(e.message).toMatch(/type, category, subcategory, amount/);
    expect(e.message).toMatch(/income,Salary,,6200.00/);
  });

  it("rejects a chat reply with an empty code block", () => {
    expect(firstError("Here you go:\n```csv\n```\nDone")).toBeDefined();
  });

  it("rejects a table with no recognisable type column, quoting what it found", () => {
    const e = firstError("category,subcategory,amount\nSalary,,3000\nRent,,1000");
    expect(e.message).toMatch(/income, expense or savings/);
    expect(e.message).toMatch(/"Salary"/);
  });

  it("rejects a header that has no type column", () => {
    const e = firstError("category,amount,notes\nSalary,3000,x\nRent,1000,y");
    expect(e.message).toMatch(/type/);
  });

  it("rejects rows whose types are not income, expense or savings", () => {
    const e = firstError("type,category,subcategory,amount\ncredit,Salary,,3000\ntransfer,Rent,,1000");
    expect(e.message).toMatch(/income, expense or savings/);
    expect(e.message).toMatch(/"credit"/);
  });

  it("rejects when every row was skipped and keeps the per-line notes", () => {
    const r = parseFlumeInput("type,category,subcategory,amount\nincome,Salary,,zero\nexpense,Rent,,0");
    expect(r.data).toBeNull();
    expect(r.issues[0].level).toBe("error");
    expect(r.issues[0].message).toMatch(/skipped/);
    expect(r.issues.filter((i) => i.level === "warning").map((i) => i.line)).toEqual([2, 3]);
  });

  it("never throws on odd input", () => {
    const weird: unknown[] = [
      null, undefined, 42, {}, [], "\u0000\u0001", "\"", "\"\"\"\"", ",,,,,\n,,,", "|||\n|||", "```", "# title:", "currency:",
      "type,category,amount\n\"unclosed,quote,5", "a".repeat(100_000), "income,\u{1F4B0},,\u{1F4B0}\n".repeat(50), "\t\t\t\n\t\t\t",
      "type,category,subcategory,amount\nincome,Salary,,1e999", "income,Salary,,9".padEnd(2000, "9"),
    ];
    for (const w of weird) {
      const r = parseFlumeInput(w as string);
      expect(r).toHaveProperty("issues");
      if (r.data === null) expect(r.issues.some((i) => i.level === "error")).toBe(true);
    }
  });

  it("returns data only with the contract's invariants", () => {
    const r = parseFlumeInput(SAMPLE_CSV);
    const keys = new Set<string>();
    for (const x of r.data!.rows) {
      expect(x.amount).toBeGreaterThan(0);
      expect(x.category).not.toBe("");
      const k = `${x.type}|${x.category}|${x.subcategory ?? ""}`;
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
  });
});
