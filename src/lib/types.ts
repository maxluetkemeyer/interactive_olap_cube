// Bounds type for viewport-based queries
export type MapBounds = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export interface WalkStep {
  from_stop_id: string;
  to_stop_id: string;
  edge_id: string;
  total_distance: number;
}

export interface WalkRequest {
  origin_stop_id: string;
  target_stop_id: string;
}

export interface WalkResponse {
  origin_stop_id: string;
  target_stop_id: string;
  distance: number;
  walk: string[] | undefined; // string list of stop ids, starting from the origin stop, origin is included as first value
}

export interface MyWalkResponse {
  origin_stop_id: string;
  target_stop_id: string;
  walk: WalkStep[] | undefined;
}
