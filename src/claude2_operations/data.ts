import type { Dimension } from "./types";

export const DIMENSIONS: Dimension[] = [
  {
    id: "product",
    name: "Product",
    members: ["Electronics", "Clothing", "Food", "Furniture"],
    hierarchy: [
      { levelName: "Category", members: ["Consumer Goods", "Durables"] },
      {
        levelName: "Subcategory",
        members: ["Electronics", "Clothing", "Food", "Furniture"],
      },
      {
        levelName: "Item",
        members: [
          "Phone",
          "Laptop",
          "Shirt",
          "Pants",
          "Bread",
          "Milk",
          "Chair",
          "Table",
        ],
      },
    ],
  },
  {
    id: "region",
    name: "Region",
    members: ["North", "South", "East", "West"],
    hierarchy: [
      { levelName: "Country", members: ["USA"] },
      { levelName: "Region", members: ["North", "South", "East", "West"] },
      {
        levelName: "City",
        members: [
          "NYC",
          "Chicago",
          "Miami",
          "Atlanta",
          "Boston",
          "Denver",
          "LA",
          "Seattle",
        ],
      },
    ],
  },
  {
    id: "time",
    name: "Time Period",
    members: ["Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"],
    hierarchy: [
      { levelName: "Year", members: ["2024"] },
      {
        levelName: "Quarter",
        members: ["Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"],
      },
      {
        levelName: "Month",
        members: [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ],
      },
    ],
  },
  {
    id: "channel",
    name: "Channel",
    members: ["Online", "Retail", "Wholesale"],
    hierarchy: [
      { levelName: "Type", members: ["Digital", "Physical"] },
      { levelName: "Channel", members: ["Online", "Retail", "Wholesale"] },
    ],
  },
  {
    id: "segment",
    name: "Customer Segment",
    members: ["Consumer", "Business", "Enterprise"],
    hierarchy: [
      { levelName: "Market", members: ["B2C", "B2B"] },
      {
        levelName: "Segment",
        members: ["Consumer", "Business", "Enterprise"],
      },
    ],
  },
];

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

export function generateCellValue(members: string[]): number {
  const key = [...members].sort().join("|");
  const hash = hashString(key);
  return hash % 1000;
}

export function getDimensionById(id: string): Dimension | undefined {
  return DIMENSIONS.find((d) => d.id === id);
}

/**
 * Finds which hierarchy level the dimension's current members correspond to.
 * Returns the level name or null if no match / no hierarchy.
 */
export function findCurrentLevel(dim: Dimension): string | null {
  if (!dim.hierarchy || dim.hierarchy.length === 0) return null;
  for (const level of dim.hierarchy) {
    if (
      dim.members.length === level.members.length &&
      dim.members.every((m) => level.members.includes(m))
    ) {
      return level.levelName;
    }
  }
  return null;
}

/**
 * Returns the display name including the hierarchy level in parentheses.
 * e.g. "Time Period (Quarter)", "Product (Subcategory)"
 */
export function getDimensionDisplayName(dim: Dimension): string {
  const level = findCurrentLevel(dim);
  if (level) return `${dim.name} (${level})`;
  return dim.name;
}