// import Gemini0 from "@/gemini0/App";

// export default function App() {
//   return <main>
//     <Gemini0 />
//   </main>
// }

export { default as OlapCube } from "@/claude0/OlapCube";
export type { Dimension, CellInfo, AxisAssignment } from "@/claude0/types";
export { DIMENSIONS } from "@/claude0/data";

// App.tsx
import { default as OlapCube } from "@/claude0/OlapCube";

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <OlapCube />
    </div>
  );
}

export default App;
