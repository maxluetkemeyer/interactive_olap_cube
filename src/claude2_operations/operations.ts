export interface OperationStep {
  label: string;
  description: string;
  duration: number;
}

export interface OperationDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  steps: OperationStep[];
}

export const OPERATIONS: OperationDef[] = [
  {
    id: "slice",
    name: "Slice",
    icon: "✂️",
    description:
      "Fix one dimension to a single value, extracting a 2D cross-section from the cube.",
    color: "#e74c3c",
    steps: [
      {
        label: "Select Plane",
        description:
          "A slice selects one member along a dimension. Here we fix the Z-axis to a single value. The highlighted plane shows the selected slice.",
        duration: 1400,
      },
      {
        label: "Cut Away",
        description:
          "All cells outside the selected plane are removed. Only the data at the fixed Z value remains.",
        duration: 1400,
      },
      {
        label: "2D Result",
        description:
          "The result is a 2D table (X × Y) at the chosen Z value. This reduces dimensionality by one — from a 3D cube to a 2D plane.",
        duration: 1400,
      },
    ],
  },
  {
    id: "dice",
    name: "Dice",
    icon: "🎲",
    description:
      "Select specific ranges on two or more dimensions to extract a sub-cube.",
    color: "#8e44ad",
    steps: [
      {
        label: "Select Ranges",
        description:
          "Dicing selects specific members on multiple dimensions simultaneously. Here we select the first two members on both X and Y axes.",
        duration: 1400,
      },
      {
        label: "Extract Sub-Cube",
        description:
          "Cells outside the selected ranges are removed. The remaining cells form a smaller sub-cube.",
        duration: 1400,
      },
      {
        label: "Sub-Cube Result",
        description:
          "The result is a smaller cube containing only the intersections of the chosen members. Unlike slice, dicing preserves all three dimensions.",
        duration: 1400,
      },
    ],
  },
  {
    id: "pivot",
    name: "Pivot",
    icon: "🔄",
    description:
      "Rotate the cube by swapping two axes, providing a different perspective on the same data.",
    color: "#2980b9",
    steps: [
      {
        label: "Select Axes",
        description:
          "Pivoting (or rotating) swaps two dimension axes. We will swap the X and Y axes to see the data from a different angle.",
        duration: 1200,
      },
      {
        label: "Rotate",
        description:
          "Each cell moves to its new position as the X and Y coordinates are exchanged. The data values remain the same — only the viewpoint changes.",
        duration: 2000,
      },
      {
        label: "New View",
        description:
          "The pivot is complete. What was on the X-axis is now on the Y-axis and vice versa. This is the same data, just reorganised for a different analysis perspective.",
        duration: 1200,
      },
    ],
  },
  {
    id: "drilldown",
    name: "Drill-Down",
    icon: "🔍",
    description:
      "Navigate from a summary level to a more detailed level within a dimension's hierarchy.",
    color: "#16a085",
    steps: [
      {
        label: "Current Level",
        description:
          "We start at the current aggregation level. Each position on the X-axis represents one member. Drill-down will reveal finer-grained detail.",
        duration: 1200,
      },
      {
        label: "Expand Detail",
        description:
          "The first member is split into its child members from the next hierarchy level. New cells appear as the dimension expands to show more detail.",
        duration: 2000,
      },
      {
        label: "Detailed View",
        description:
          "Drill-down is complete. The X-axis now shows a more detailed level of the hierarchy. The cube has more cells, each representing a finer slice of the data.",
        duration: 1400,
      },
    ],
  },
  {
    id: "rollup",
    name: "Roll-Up",
    icon: "📊",
    description:
      "Aggregate data by moving from a detailed level to a summary level in the hierarchy.",
    color: "#d35400",
    steps: [
      {
        label: "Current Detail",
        description:
          "We start at the detailed level. Roll-up will aggregate adjacent members by moving up the hierarchy — the reverse of drill-down.",
        duration: 1200,
      },
      {
        label: "Aggregate",
        description:
          "Adjacent members are merged. Their measure values are summed into a single aggregated cell. The first two X-members combine into one parent member.",
        duration: 2000,
      },
      {
        label: "Summary View",
        description:
          "Roll-up is complete. The X-axis now shows a coarser, summarised level. Fewer cells, each representing aggregated data. Values are the sum of their children.",
        duration: 1400,
      },
    ],
  },
];

export function getOperationById(id: string): OperationDef | undefined {
  return OPERATIONS.find((o) => o.id === id);
}