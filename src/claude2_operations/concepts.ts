import type { ConceptId } from "./types";

export interface ConceptDef {
  id: ConceptId;
  label: string;
  shortDesc: string;
  longDesc: string;
  color: string;
  icon: string;
}

export const CONCEPTS: ConceptDef[] = [
  {
    id: "dimensions",
    label: "Dimensions",
    shortDesc: "The axes of analysis",
    longDesc:
      "Dimensions are the structural axes of a cube that define how data is organized. Each edge of the cube represents one dimension (e.g. Product, Region, Time). They provide the context for every data point.",
    color: "#7c3aed",
    icon: "⬡",
  },
  {
    id: "members",
    label: "Members",
    shortDesc: "Individual values within a dimension",
    longDesc:
      'Members are the discrete values along a dimension. For example, the Region dimension has members "North", "South", "East", "West". Each member defines one slice position along its axis.',
    color: "#0891b2",
    icon: "◈",
  },
  {
    id: "cells",
    label: "Cells",
    shortDesc: "Intersection points in the cube",
    longDesc:
      "A cell is a single data point located at the intersection of one member from each dimension. The total number of cells = product of all dimension cardinalities. Each cell holds one or more measure values.",
    color: "#059669",
    icon: "▣",
  },
  {
    id: "measures",
    label: "Measures",
    shortDesc: "Numeric values stored in cells",
    longDesc:
      "Measures are the quantitative values stored in each cell — the actual business metrics like Revenue, Quantity, or Profit. They are the numbers you analyze across dimensions.",
    color: "#d97706",
    icon: "▥",
  },
  {
    id: "facts",
    label: "Facts",
    shortDesc: "The entire data space",
    longDesc:
      "The fact table (or fact space) is the full collection of all cells with their measures. The cube itself is a multidimensional representation of the fact table. Every record maps to one cell in the cube.",
    color: "#dc2626",
    icon: "◼",
  },
  {
    id: "granularity",
    label: "Granularity / Level",
    shortDesc: "Detail level of dimensions",
    longDesc:
      'Granularity defines the finest level of detail in each dimension. For Time, granularity could be Year, Quarter, or Month. Finer granularity = more cells. Also called the "grain" of the cube.',
    color: "#be185d",
    icon: "◎",
  },
  {
    id: "attributes",
    label: "Attributes",
    shortDesc: "Properties describing members",
    longDesc:
      'Attributes are descriptive properties of dimension members that are not used to aggregate but to describe. For example, a Product member "Phone" might have attributes like Color, Weight, or Manufacturer.',
    color: "#4f46e5",
    icon: "◇",
  },
  {
    id: "hierarchies",
    label: "Hierarchies",
    shortDesc: "Drill-down levels within dimensions",
    longDesc:
      "Hierarchies define parent-child relationships within a dimension, enabling drill-down and roll-up. For example: Year → Quarter → Month. They allow aggregation at different levels of detail.",
    color: "#0d9488",
    icon: "△",
  },
];

export function getConceptById(id: ConceptId): ConceptDef {
  return CONCEPTS.find((c) => c.id === id)!;
}