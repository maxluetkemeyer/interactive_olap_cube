import type { Dimension } from "./types";

export const DIMENSIONS: Dimension[] = [
  {
    id: "product",
    name: "Product",
    members: ["Electronics", "Clothing", "Food", "Furniture"],
    hierarchy: [
      { levelName: "Category", members: ["Consumer Goods", "Durables"] },
      { levelName: "Subcategory", members: ["Electronics", "Clothing", "Food", "Furniture"] },
      { levelName: "Item", members: ["Phone", "Laptop", "Shirt", "Pants", "Bread", "Milk", "Chair", "Table"] },
    ],
  },
  {
    id: "region",
    name: "Region",
    members: ["North", "South", "East", "West"],
    hierarchy: [
      { levelName: "Country", members: ["USA"] },
      { levelName: "Region", members: ["North", "South", "East", "West"] },
      { levelName: "City", members: ["NYC", "Chicago", "Miami", "Atlanta", "Boston", "Denver", "LA", "Seattle"] },
    ],
  },
  {
    id: "time",
    name: "Time Period",
    members: ["Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"],
    hierarchy: [
      { levelName: "Year", members: ["2024"] },
      { levelName: "Quarter", members: ["Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"] },
      { levelName: "Month", members: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
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
      { levelName: "Segment", members: ["Consumer", "Business", "Enterprise"] },
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
  return hashString(key) % 1000;
}

export function getDimensionById(id: string): Dimension | undefined {
  return DIMENSIONS.find((d) => d.id === id);
}

/**
 * Returns the index of the hierarchy level whose members match the
 * dimension's default members. Falls back to 0.
 */
export function getDefaultLevelIndex(dim: Dimension): number {
  if (!dim.hierarchy || dim.hierarchy.length === 0) return -1;
  for (let i = 0; i < dim.hierarchy.length; i++) {
    const lv = dim.hierarchy[i];
    if (
      dim.members.length === lv.members.length &&
      dim.members.every((m) => lv.members.includes(m))
    ) {
      return i;
    }
  }
  return 0;
}

/**
 * Returns a copy of the dimension with its members replaced by those at
 * the given hierarchy level index.
 */
export function getDimensionAtLevel(
  dimId: string,
  levelIndex: number
): Dimension {
  const dim = getDimensionById(dimId)!;
  if (
    !dim.hierarchy ||
    levelIndex < 0 ||
    levelIndex >= dim.hierarchy.length
  ) {
    return dim;
  }
  return { ...dim, members: [...dim.hierarchy[levelIndex].members] };
}

/**
 * Finds which hierarchy level the supplied member list corresponds to.
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
 * Returns display name including the hierarchy level in parentheses.
 * If levelIndex is provided, it takes priority.
 */
export function getDimensionDisplayName(
  dim: Dimension,
  levelIndex?: number
): string {
  if (
    levelIndex !== undefined &&
    dim.hierarchy &&
    levelIndex >= 0 &&
    levelIndex < dim.hierarchy.length
  ) {
    return `${dim.name} (${dim.hierarchy[levelIndex].levelName})`;
  }
  const level = findCurrentLevel(dim);
  if (level) return `${dim.name} (${level})`;
  return dim.name;
}