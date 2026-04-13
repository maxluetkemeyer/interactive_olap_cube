export interface Dimension {
  id: string;
  name: string;
  members: string[];
}

export interface CellInfo {
  xIndex: number;
  yIndex: number;
  zIndex: number;
  xMember: string;
  yMember: string;
  zMember: string;
  xDimension: string;
  yDimension: string;
  zDimension: string;
  value: number;
}

export interface AxisAssignment {
  x: string;
  y: string;
  z: string;
}