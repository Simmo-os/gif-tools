import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Point } from '../types';

interface EditorProps {
  imageSrc: string;
  width: number;
  height: number;
  points: Point[];
  setPoints: React.Dispatch<React.SetStateAction<Point[]>>;
  scale: number;
  referenceImageSrc?: string | null;
  referenceOpacity?: number;
  referencePos?: { x: number; y: number };
  setReferencePos?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  referenceScale?: number;
  setReferenceScale?: React.Dispatch<React.SetStateAction<number>>;
}

const HANDLE_RADIUS = 6;

const Editor: React.FC<EditorProps> = ({ 
  imageSrc, 
  width, 
  height, 
  points, 
  setPoints, 
  scale,
  referenceImageSrc,
  referenceOpacity = 0.5,
  referencePos = { x: 0, y: 0 },
  setReferencePos,
  referenceScale = 1,
  setReferenceScale
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  
  // Reference dragging state
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({ 
    mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 
  });

  // Initial points setup if empty
  useEffect(() => {
    if (points.length === 0 && width > 0 && height > 0) {
      const padding = Math.min(width, height) * 0.2;
      const initialPoints: Point[] = [
        { id: '1', x: width * 0.5, y: padding },
        { id: '2', x: width - padding, y: height * 0.5 },
        { id: '3', x: width * 0.5, y: height - padding },
        { id: '4', x: padding, y: height * 0.5 },
      ];
      setPoints(initialPoints);
    }
  }, [width, height, points.length, setPoints]);

  const getMousePos = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  };

  // --- Point Dragging Handlers ---

  const handlePointMouseDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePointId(id);
  };

  const handlePointMouseMove = useCallback((e: MouseEvent) => {
    if (!activePointId) return;
    
    const pos = getMousePos(e);
    // Clamp to bounds
    const clampedX = Math.max(0, Math.min(width, pos.x));
    const clampedY = Math.max(0, Math.min(height, pos.y));

    setPoints(prev => prev.map(p => 
      p.id === activePointId ? { ...p, x: clampedX, y: clampedY } : p
    ));
  }, [activePointId, width, height, scale, setPoints]);

  const handlePointMouseUp = useCallback(() => {
    setActivePointId(null);
  }, []);

  // --- Reference Dragging Handlers ---

  const handleRefMouseDown = (e: React.MouseEvent) => {
    if (activePointId || !setReferencePos) return;
    e.preventDefault(); // Prevent image dragging default browser behavior
    e.stopPropagation();
    setIsDraggingRef(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: referencePos.x,
      initialY: referencePos.y
    };
  };

  const handleRefMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef || !setReferencePos) return;
    
    const deltaX = e.clientX - dragStartRef.current.mouseX;
    const deltaY = e.clientY - dragStartRef.current.mouseY;

    // Movement isn't affected by scale for the drag feel usually, 
    // but visual displacement should match cursor.
    // If the container is scaled, the delta should probably be standard pixels if translate is pixels.
    setReferencePos({
      x: dragStartRef.current.initialX + deltaX,
      y: dragStartRef.current.initialY + deltaY
    });
  }, [isDraggingRef, setReferencePos]);

  const handleRefMouseUp = useCallback(() => {
    setIsDraggingRef(false);
  }, []);

  const handleRefWheel = (e: React.WheelEvent) => {
    if (!setReferenceScale) return;
    // e.stopPropagation(); // Let it bubble if we want page scroll, but usually we want zoom
    e.preventDefault(); // Stop page scroll
    
    const zoomIntensity = 0.001;
    const newScale = Math.min(Math.max(0.1, referenceScale + e.deltaY * -zoomIntensity), 5);
    setReferenceScale(newScale);
  };

  // --- Global Listeners ---

  useEffect(() => {
    if (activePointId) {
      window.addEventListener('mousemove', handlePointMouseMove);
      window.addEventListener('mouseup', handlePointMouseUp);
    }
    if (isDraggingRef) {
      window.addEventListener('mousemove', handleRefMouseMove);
      window.addEventListener('mouseup', handleRefMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handlePointMouseMove);
      window.removeEventListener('mouseup', handlePointMouseUp);
      window.removeEventListener('mousemove', handleRefMouseMove);
      window.removeEventListener('mouseup', handleRefMouseUp);
    };
  }, [activePointId, isDraggingRef, handlePointMouseMove, handlePointMouseUp, handleRefMouseMove, handleRefMouseUp]);

  // Insert point on line click
  const handleLineClick = (index: number, e: React.MouseEvent) => {
    const pos = getMousePos(e);
    const newPoint = { id: crypto.randomUUID(), x: pos.x, y: pos.y };
    setPoints(prev => {
      const newPoints = [...prev];
      newPoints.splice(index + 1, 0, newPoint);
      return newPoints;
    });
  };

  const handleDeletePoint = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (points.length <= 3) return; // Maintain minimum polygon
    setPoints(prev => prev.filter(p => p.id !== id));
  };

  // Convert points string for SVG polygon
  const pointsString = points.map(p => `${p.x * scale},${p.y * scale}`).join(' ');

  return (
    <div className="relative shadow-2xl rounded-lg overflow-hidden ring-1 ring-slate-700 select-none">
      {/* Container sizing */}
      <div 
        ref={containerRef}
        style={{ 
          width: width * scale, 
          height: height * scale,
        }}
        className="relative checkerboard"
      >
        {/* Background Image (First Frame) */}
        <img 
          src={imageSrc} 
          alt="GIF Reference" 
          className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-80"
          draggable={false}
        />

        {/* Reference Image Overlay */}
        {referenceImageSrc && (
          <div
            className="absolute inset-0 w-full h-full overflow-hidden"
            style={{ 
              pointerEvents: activePointId ? 'none' : 'auto' 
            }}
          >
            <div
               onMouseDown={handleRefMouseDown}
               onWheel={handleRefWheel}
               style={{
                 transform: `translate(${referencePos.x}px, ${referencePos.y}px) scale(${referenceScale})`,
                 transformOrigin: 'center center',
                 opacity: referenceOpacity,
                 cursor: isDraggingRef ? 'grabbing' : 'grab'
               }}
               className="w-full h-full flex items-center justify-center"
            >
              <img 
                src={referenceImageSrc} 
                alt="Reference Guide" 
                className="w-full h-full object-contain pointer-events-none"
                draggable={false}
              />
            </div>
          </div>
        )}

        {/* SVG Overlay */}
        <svg 
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ width: width * scale, height: height * scale }}
        >
          {/* Mask Definition */}
          <defs>
            <mask id="crop-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" fillOpacity="0.5" />
              <polygon points={pointsString} fill="black" />
            </mask>
          </defs>

          {/* Darken outside area */}
          <rect 
            x="0" y="0" width="100%" height="100%" 
            fill="rgba(0,0,0,0.6)" 
            mask="url(#crop-mask)"
            className="pointer-events-none"
          />

          {/* Polygon Lines (Clickable for adding points) */}
          {points.map((p, i) => {
            const nextP = points[(i + 1) % points.length];
            return (
              <line
                key={`line-${i}`}
                x1={p.x * scale}
                y1={p.y * scale}
                x2={nextP.x * scale}
                y2={nextP.y * scale}
                stroke="#10b981"
                strokeWidth="3"
                className="cursor-copy hover:stroke-accent-400 transition-colors pointer-events-auto"
                onClick={(e) => handleLineClick(i, e)}
              />
            );
          })}

          {/* Vertices */}
          {points.map((p) => (
            <g 
              key={p.id}
              transform={`translate(${p.x * scale}, ${p.y * scale})`}
              onMouseDown={(e) => handlePointMouseDown(p.id, e)}
              onDoubleClick={(e) => handleDeletePoint(p.id, e)}
              className="cursor-move pointer-events-auto group"
            >
               {/* Invisible larger hit area for easier clicking */}
               <circle
                r={HANDLE_RADIUS + 8}
                fill="transparent"
              />
              <circle
                r={HANDLE_RADIUS + 2}
                fill="rgba(16, 185, 129, 0.2)"
                className="transition-all duration-200 group-hover:fill-rgba(16, 185, 129, 0.4)"
              />
              <circle
                r={HANDLE_RADIUS}
                fill="#10b981"
                stroke="#fff"
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>

        {/* Helper Hint */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-white pointer-events-none z-10 whitespace-nowrap">
           Drag points to shape • Double-click to delete • Scroll to scale ref
        </div>
      </div>
    </div>
  );
};

export default Editor;