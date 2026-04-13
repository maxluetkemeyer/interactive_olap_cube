import { useState } from 'react';
import { OLAPCube } from './OLAPCube';

const AVAILABLE_DIMENSIONS = ['Time', 'Product', 'Region', 'Department', 'Sales Channel'];

export default function Gemini0() {
  const [dims, setDims] = useState({
    x: 'Time',
    y: 'Product',
    z: 'Region'
  });

  const updateDim = (axis: 'x' | 'y' | 'z', value: string) => {
    setDims(prev => ({ ...prev, [axis]: value }));
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Interactive OLAP Cube</h1>
      
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        {(['x', 'y', 'z'] as const).map(axis => (
          <div key={axis}>
            <label style={{ marginRight: '8px' }}>{axis.toUpperCase()} Axis:</label>
            <select 
              value={dims[axis]} 
              onChange={(e) => updateDim(axis, e.target.value)}
            >
              {AVAILABLE_DIMENSIONS.map(d => (
                <option key={d} value={d} disabled={Object.values(dims).includes(d) && dims[axis] !== d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <OLAPCube dimensions={dims} size={5} />
      
      <div style={{ marginTop: '10px', color: '#666' }}>
        <p><strong>Controls:</strong> Left-click to rotate | Right-click to pan | Scroll to zoom | Click a cell to drill down.</p>
      </div>
    </div>
  );
}