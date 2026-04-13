import { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text, PerspectiveCamera } from '@react-three/drei';

interface CellProps {
  position: [number, number, number];
  data: unknown;
  onClick: (coords: [number, number, number]) => void;
}

const Cell = ({ position, onClick }: CellProps) => {
  const [hovered, setHover] = useState(false);

  return (
    <mesh
      position={position}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      onClick={() => onClick(position)}
    >
      <boxGeometry args={[0.9, 0.9, 0.9]} />
      <meshStandardMaterial 
        color={hovered ? '#ffeb3b' : '#2196f3'} 
        transparent 
        opacity={hovered ? 1 : 0.6} 
      />
    </mesh>
  );
};

interface OLAPProps {
  dimensions: { x: string; y: string; z: string };
  size?: number;
}

export const OLAPCube = ({ dimensions, size = 4 }: OLAPProps) => {
  const cells = useMemo(() => {
    const temp = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          temp.push([x, y, z] as [number, number, number]);
        }
      }
    }
    return temp;
  }, [size]);

  const handleCellClick = (coords: [number, number, number]) => {
    alert(`Clicked Cell at:\n${dimensions.x}: ${coords[0]}\n${dimensions.y}: ${coords[1]}\n${dimensions.z}: ${coords[2]}`);
  };

  return (
    <div style={{ width: '100%', height: '500px', background: '#111', borderRadius: '8px' }}>
      <Canvas>
        <PerspectiveCamera makeDefault position={[size * 2, size * 2, size * 2]} />
        <OrbitControls makeDefault />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />

        {/* Render Cells */}
        {cells.map((pos, i) => (
          <Cell key={i} position={pos} onClick={handleCellClick} data={null} />
        ))}

        {/* Axis Labels */}
        <AxisLabel position={[size / 2, -1, -1]} text={dimensions.x} color="red" />
        <AxisLabel position={[-1, size / 2, -1]} text={dimensions.y} color="green" rotation={[0, 0, Math.PI / 2]} />
        <AxisLabel position={[-1, -1, size / 2]} text={dimensions.z} color="blue" rotation={[0, -Math.PI / 2, 0]} />

        <gridHelper args={[20, 20]} position={[size/2 - 0.5, -0.5, size/2 - 0.5]} />
      </Canvas>
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AxisLabel = ({ position, text, color, rotation = [0, 0, 0] }: any) => (
  <group position={position} rotation={rotation}>
    <Text fontSize={0.5} color={color} anchorX="center" anchorY="middle">
      {text.toUpperCase()}
    </Text>
  </group>
);