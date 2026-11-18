import { buildGraph } from "@/lib/flume/graph";
import { parseFlumeInput } from "@/lib/flume/parse";
import { SAMPLE_CSV } from "@/lib/flume/sample";
import type { Detail, FlumeGraph } from "@/lib/flume/types";

/**
 * Stress datasets for the chart scratch page. Each is CSV in the format the
 * agent prompt asks for, run through the real parser and graph builder.
 */

/** 1 income, 3 expenses, a big surplus. */
const TINY_CSV = `# title: A quiet month
# currency: USD
type,category,subcategory,amount
income,Salary,,4200
expense,Rent,,1500
expense,Food,,640
expense,Fun,,310
`;

/**
 * 4 incomes with details; 8 expense and 2 savings categories with 7
 * subcategories each (70 detail nodes), several tiny values and long names.
 */
const HEAVY_CSV = `# title: Household, Q3 2026
# currency: USD
type,category,subcategory,amount
income,Salary,Base pay,10400
income,Salary,Performance bonus,1400
income,Salary,Stock vesting,950
income,Freelance,Design retainers,1800
income,Freelance,Workshop fees,420
income,Rental income,Unit A,1350
income,Rental income,Unit B,1100
income,Investments,Dividends,380
income,Investments,Interest,96
expense,Housing,Mortgage,2850
expense,Housing,Property tax,410
expense,Housing,Homeowners association dues,185
expense,Housing,Electricity,142
expense,Housing,Water and sewer,68
expense,Housing,Internet,75
expense,Housing,Repairs,60
expense,Food and dining,Groceries,980
expense,Food and dining,Restaurants,455
expense,Food and dining,Takeout,210
expense,Food and dining,Coffee shops,96
expense,Food and dining,Work lunches,132
expense,Food and dining,Meal kits,118
expense,Food and dining,Bakery,62
expense,Transportation,Car payment,489
expense,Transportation,Gas,210
expense,Transportation,Car insurance,165
expense,Transportation,Parking,90
expense,Transportation,Public transit,72
expense,Transportation,Rideshare,84
expense,Transportation,Maintenance,65
expense,Health,Health insurance premiums,520
expense,Health,Dentist,140
expense,Health,Prescriptions,62
expense,Health,Gym membership,79
expense,Health,Therapy,240
expense,Health,Vision,60
expense,Health,Supplements,61
expense,Kids,Daycare,1150
expense,Kids,After-school programs,260
expense,Kids,Clothing,95
expense,Kids,Toys,62
expense,Kids,School supplies,64
expense,Kids,Activities,180
expense,Kids,Babysitting,120
expense,Shopping,Clothing,240
expense,Shopping,Electronics,310
expense,Shopping,Home goods,165
expense,Shopping,Gifts,120
expense,Shopping,Books,61
expense,Shopping,Hobbies,88
expense,Shopping,Personal care,74
expense,Entertainment,Streaming services,64
expense,Entertainment,Concerts,150
expense,Entertainment,Movies,61
expense,Entertainment,Video games,70
expense,Entertainment,Music,60.5
expense,Entertainment,Museums,62
expense,Entertainment,Sports tickets,95
expense,Travel,Flights,640
expense,Travel,Hotels,480
expense,Travel,Rental car,150
expense,Travel,Food on the road,170
expense,Travel,Activities,120
expense,Travel,Travel insurance,61
expense,Travel,Baggage fees,60
savings,Retirement,401(k),900
savings,Retirement,Roth IRA,500
savings,Retirement,Employer match,450
savings,Retirement,Pension top-up,120
savings,Retirement,HSA,150
savings,Retirement,Bonds,80
savings,Retirement,Target-date fund,100
savings,Goals,Emergency fund,400
savings,Goals,House down payment,600
savings,Goals,College fund,250
savings,Goals,Vacation fund,150
savings,Goals,New car,200
savings,Goals,Wedding,100
savings,Goals,Holiday gifts,61
`;

/** Spending beyond income: a "From savings" source appears. */
const SHORTFALL_CSV = `# title: Moving month
# currency: USD
type,category,subcategory,amount
income,Salary,,3400
income,Side gig,,280
expense,Housing,Rent,1650
expense,Housing,Security deposit,1650
expense,Housing,Movers,480
expense,Food,Groceries,410
expense,Food,Restaurants,190
expense,Transport,,160
expense,Shopping,Furniture,720
expense,Shopping,Kitchen,140
expense,Other,,85
savings,Emergency fund,,100
`;

export const FIXTURES = {
  sample: { label: "Sample", csv: SAMPLE_CSV },
  tiny: { label: "Tiny", csv: TINY_CSV },
  heavy: { label: "Heavy", csv: HEAVY_CSV },
  shortfall: { label: "Shortfall", csv: SHORTFALL_CSV },
} as const;

export type FixtureName = keyof typeof FIXTURES;

export function fixtureGraph(name: FixtureName, detail: Detail): FlumeGraph {
  const { data, issues } = parseFlumeInput(FIXTURES[name].csv);
  if (!data) {
    throw new Error(`Fixture "${name}" did not parse: ${issues.map((i) => i.message).join("; ")}`);
  }
  return buildGraph(data, { detail });
}
