// import Gemini0 from "@/gemini0/App";

// export default function App() {
//   return <main>
//     <Gemini0 />
//   </main>
// }

export { default as OlapCube } from "@/claude1_concepts/OlapCube";
export type {
  Dimension,
  CellInfo,
  AxisAssignment,
} from "@/claude1_concepts/types";
export { DIMENSIONS } from "@/claude1_concepts/data";

// App.tsx
import { default as OlapCube } from "@/claude1_concepts/OlapCube";

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <OlapCube />
    </div>
  );
}

export default App;
