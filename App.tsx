import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Loader2, Image as ImageIcon, Trash, RefreshCw, Scissors, Layers, Move, RotateCw, Settings, HardDrive } from 'lucide-react';
import Editor from './components/Editor';
import { loadGifFrames, processGifRobust } from './utils/gifProcessor';
import { Point, ToolState } from './types';

const App: React.FC = () => {
  // State
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<any[]>([]);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState<ToolState>(ToolState.IDLE);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("Processing Frames...");
  const [error, setError] = useState<string | null>(null);
  const [finalSizeMB, setFinalSizeMB] = useState<number>(0);

  // File Size Settings
  const [limitFileSize, setLimitFileSize] = useState(false);
  const [maxFileSize, setMaxFileSize] = useState<number>(5); // Default 5MB

  // Reference Image State
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState<number>(0.5);
  const [referencePos, setReferencePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [referenceScale, setReferenceScale] = useState<number>(1);

  // Scaling logic to fit screen
  const [scale, setScale] = useState(1);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dims && editorContainerRef.current) {
      const containerWidth = editorContainerRef.current.clientWidth - 48; // Padding
      const containerHeight = window.innerHeight - 200; // Header/Footer buffer
      
      const scaleX = containerWidth / dims.width;
      const scaleY = containerHeight / dims.height;
      const newScale = Math.min(scaleX, scaleY, 1); // Never upscale, only downscale
      setScale(newScale);
    }
  }, [dims]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/gif') {
      setError('Please upload a valid GIF file.');
      return;
    }

    setGifFile(file);
    setError(null);
    setStatus(ToolState.PROCESSING);
    setStatusMessage("Parsing GIF...");
    setProgress(0.1);
    setProcessedUrl(null);
    setPoints([]); // Reset points
    setFinalSizeMB(0);

    try {
      const objectUrl = URL.createObjectURL(file);
      setOriginalUrl(objectUrl);

      // Parse Frames
      const parsedFrames = await loadGifFrames(file);
      setFrames(parsedFrames);
      
      if (parsedFrames.length > 0) {
        const w = parsedFrames[0].dims.width;
        const h = parsedFrames[0].dims.height;
        setDims({ width: w, height: h });
      }
      
      setStatus(ToolState.DRAGGING);
      setProgress(0);
    } catch (err) {
      console.error(err);
      setError('Failed to parse GIF. Try a different file.');
      setStatus(ToolState.IDLE);
    }
  };

  const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setReferenceUrl(objectUrl);
    
    setReferencePos({ x: 0, y: 0 });
    setReferenceScale(1);
    setReferenceOpacity(0.5);
  };

  const handleExport = async () => {
    if (!dims || frames.length === 0) return;

    setStatus(ToolState.PROCESSING);
    setStatusMessage("Rendering GIF...");
    setProgress(0);

    // Initial Parameters - Start with original dimensions
    let currentW = dims.width;
    let currentH = dims.height;
    // We strictly maintain frame rate now (skip = 1)
    const currentSkip = 1; 
    let currentQuality = 10;
    let attempt = 0;
    const MAX_ATTEMPTS = 5;

    try {
      while (attempt < MAX_ATTEMPTS) {
        attempt++;
        
        // Pass parameters to processor
        const blob = await processGifRobust(
          frames,
          points,
          dims.width,
          dims.height,
          currentW,
          currentH,
          (p) => setProgress(p),
          currentSkip,
          currentQuality
        );

        const sizeMB = blob.size / (1024 * 1024);
        setFinalSizeMB(sizeMB);

        // If no limit or size is within limit, we are done
        if (!limitFileSize || sizeMB <= maxFileSize) {
          const url = URL.createObjectURL(blob);
          setProcessedUrl(url);
          setStatus(ToolState.COMPLETED);
          return;
        }

        // --- Optimization Logic ---
        
        // Calculate how far we are from target
        const ratio = maxFileSize / sizeMB;
        
        // Target slightly smaller to ensure we pass next time (0.9 safety factor)
        // Since pixel count is area (W*H), we scale dims by sqrt(ratio).
        const safetyRatio = ratio * 0.9;
        const scaleFactor = Math.sqrt(safetyRatio);
        
        let optMessage = `Optimization Pass ${attempt}: `;

        // Logic:
        // Always reduce dimensions based on the ratio.
        // As attempts increase, also degrade quality to help compress without reducing size too much.
        
        currentW = Math.max(32, Math.floor(currentW * scaleFactor));
        currentH = Math.max(32, Math.floor(currentH * scaleFactor));

        if (attempt === 1) {
            // First pass: mainly resize, slight quality drop
            currentQuality = 15;
            optMessage += `Resizing to ${currentW}x${currentH}...`;
        } else if (attempt === 2) {
             // Second pass: more resize + lower quality
             currentQuality = 20;
             optMessage += `Resizing & reducing quality...`;
        } else {
             // Desperate pass
             currentQuality = 30; // Max supported degradation usually
             optMessage += `Maximum compression...`;
        }
        
        setStatusMessage(`File too large (${sizeMB.toFixed(1)}MB). ${optMessage}`);
        
        // Safety break for extremely small images
        if (currentW < 32 || currentH < 32) {
           console.warn("Image too small to compress further.");
           const url = URL.createObjectURL(blob);
           setProcessedUrl(url);
           setStatus(ToolState.COMPLETED);
           return;
        }
      }

      // If loop finishes without success, return the last result
      setError("Could not compress to target size. Returning best effort.");
      
    } catch (err) {
      console.error(err);
      setError('Failed to generate GIF.');
      setStatus(ToolState.DRAGGING);
    }
  };

  const reset = () => {
    setGifFile(null);
    setFrames([]);
    setOriginalUrl(null);
    setProcessedUrl(null);
    setPoints([]);
    setDims(null);
    setStatus(ToolState.IDLE);
    setReferenceUrl(null);
    setReferencePos({ x: 0, y: 0 });
    setReferenceScale(1);
    setFinalSizeMB(0);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-slate-100 font-sans">
      {/* Header */}
      <header className="flex-none h-16 border-b border-surface flex items-center justify-between px-6 bg-surface/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-accent to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            GifShape
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          {status !== ToolState.IDLE && (
            <button 
              onClick={reset}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <Trash className="w-4 h-4" />
              Reset
            </button>
          )}
          
          {processedUrl && (
            <a 
              href={processedUrl}
              download="shaped-gif.gif"
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-emerald-400 text-slate-900 font-semibold rounded-full text-sm transition-all shadow-lg hover:shadow-accent/20"
            >
              <Download className="w-4 h-4" />
              Download GIF
            </a>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden relative">
        
        {/* Editor Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          
          {/* Loading/Progress Overlay */}
          {status === ToolState.PROCESSING && (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-accent animate-spin mb-4" />
              <p className="text-lg font-medium text-slate-200">{statusMessage}</p>
              <div className="w-64 h-2 bg-surface rounded-full mt-4 overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="text-sm text-slate-500 mt-2">{Math.round(progress * 100)}%</p>
            </div>
          )}

          {/* Empty State / Upload */}
          {status === ToolState.IDLE && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="max-w-md w-full border-2 border-dashed border-slate-700 bg-surface/30 rounded-2xl p-10 flex flex-col items-center text-center hover:border-accent/50 hover:bg-surface/50 transition-all group">
                <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Upload className="w-10 h-10 text-slate-400 group-hover:text-accent" />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-white">Upload a GIF</h2>
                <p className="text-slate-400 mb-8">Drag & drop or click to upload. Supports animated GIFs.</p>
                <label className="cursor-pointer">
                  <span className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-blue-500/25 transition-all">
                    Choose File
                  </span>
                  <input 
                    type="file" 
                    accept="image/gif" 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                </label>
                {error && (
                  <div className="mt-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editor Canvas */}
          {(status === ToolState.DRAGGING || status === ToolState.COMPLETED) && originalUrl && dims && (
            <div 
              ref={editorContainerRef} 
              className="flex-1 flex items-center justify-center bg-[#0a0f1e] p-8 overflow-auto"
            >
              {processedUrl ? (
                 <div className="flex flex-col items-center gap-4">
                    <h3 className="text-slate-400 uppercase tracking-widest text-xs font-bold">Preview</h3>
                    <div className="relative checkerboard rounded-lg shadow-2xl ring-1 ring-white/10">
                        <img src={processedUrl} alt="Processed" style={{ maxHeight: '70vh' }} />
                    </div>
                    <div className="text-sm text-slate-400 font-mono">
                        <span className="text-emerald-400">{finalSizeMB.toFixed(2)} MB</span> 
                        <span className="mx-2">•</span>
                        Generated
                    </div>
                    <button 
                        onClick={() => { setProcessedUrl(null); setStatus(ToolState.DRAGGING); }}
                        className="mt-4 flex items-center gap-2 text-slate-400 hover:text-white"
                    >
                        <RefreshCw className="w-4 h-4" /> Keep Editing
                    </button>
                 </div>
              ) : (
                <Editor 
                  imageSrc={originalUrl}
                  width={dims.width}
                  height={dims.height}
                  points={points}
                  setPoints={setPoints}
                  scale={scale}
                  referenceImageSrc={referenceUrl}
                  referenceOpacity={referenceOpacity}
                  referencePos={referencePos}
                  setReferencePos={setReferencePos}
                  referenceScale={referenceScale}
                  setReferenceScale={setReferenceScale}
                />
              )}
            </div>
          )}
        </div>

        {/* Sidebar Controls */}
        {status !== ToolState.IDLE && !processedUrl && (
          <aside className="w-80 border-l border-surface bg-surface/30 backdrop-blur-sm p-6 flex flex-col gap-6 overflow-y-auto">
            
            {/* Instructions */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Instructions</h3>
              <ul className="space-y-3 text-sm text-slate-300">
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-surface border border-slate-600 flex items-center justify-center shrink-0 text-xs">1</div>
                  <span>Drag the green dots to define your shape.</span>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-surface border border-slate-600 flex items-center justify-center shrink-0 text-xs">2</div>
                  <span>Click on a line to add point. Double-click point to delete.</span>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-surface border border-slate-600 flex items-center justify-center shrink-0 text-xs">3</div>
                  <span>Drag or scroll image overlay to position it.</span>
                </li>
              </ul>
            </div>

            {/* Reference Image Control */}
            <div className="bg-surface/20 rounded-xl p-4 border border-slate-700/50">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-accent" />
                Reference Image
              </h3>
              
              {!referenceUrl ? (
                <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-slate-600 rounded-lg hover:border-slate-500 hover:bg-slate-700/30 transition-all cursor-pointer">
                  <ImageIcon className="w-6 h-6 text-slate-500 mb-1" />
                  <span className="text-xs text-slate-400">Upload Overlay Guide</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleReferenceUpload} 
                  />
                </label>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
                    <span className="text-xs text-slate-400 truncate max-w-[120px]">Reference active</span>
                    <button 
                      onClick={() => setReferenceUrl(null)}
                      className="text-red-400 hover:text-red-300 p-1 hover:bg-red-400/10 rounded"
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400">
                        <span>Opacity</span>
                        <span>{Math.round(referenceOpacity * 100)}%</span>
                     </div>
                     <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05"
                        value={referenceOpacity}
                        onChange={(e) => setReferenceOpacity(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-accent"
                     />
                  </div>

                  <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-400">
                        <span>Scale</span>
                        <span>{Math.round(referenceScale * 100)}%</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <RotateCw className="w-3 h-3 text-slate-500" />
                       <input 
                          type="range" 
                          min="0.1" 
                          max="3" 
                          step="0.1"
                          value={referenceScale}
                          onChange={(e) => setReferenceScale(parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-accent"
                       />
                     </div>
                  </div>

                  <div className="text-[10px] text-slate-500 text-center border-t border-slate-700 pt-2 flex items-center justify-center gap-2">
                    <Move className="w-3 h-3" /> Drag image to move
                  </div>
                </div>
              )}
            </div>

            {/* Export Settings */}
            <div className="bg-surface/20 rounded-xl p-4 border border-slate-700/50">
               <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-accent" />
                Export Settings
              </h3>
              
              {/* File Size Limit */}
              <div>
                 <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-400 flex items-center gap-2">
                      <HardDrive className="w-3 h-3" />
                      Smart File Size Limit
                    </label>
                    <input 
                      type="checkbox"
                      checked={limitFileSize}
                      onChange={(e) => setLimitFileSize(e.target.checked)}
                      className="accent-accent w-4 h-4"
                    />
                 </div>
                 
                 {limitFileSize && (
                   <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-slate-500">Max</span>
                      <input 
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={maxFileSize}
                        onChange={(e) => setMaxFileSize(parseFloat(e.target.value))}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm focus:border-accent focus:outline-none"
                      />
                      <span className="text-xs text-slate-400">MB</span>
                   </div>
                 )}
                 {limitFileSize && (
                   <div className="text-[10px] text-slate-500 mt-2 p-2 bg-slate-800/50 rounded leading-relaxed border border-slate-700">
                     Automatically reduces dimensions and quality to fit target size. 
                     <br/><span className="text-accent/80">Full framerate preserved.</span>
                   </div>
                 )}
              </div>
            </div>

            <div className="mt-auto pt-4 border-t border-slate-700/50">
              <button 
                onClick={handleExport}
                className="w-full py-4 bg-accent hover:bg-emerald-400 text-slate-900 font-bold rounded-xl shadow-lg shadow-accent/20 hover:shadow-accent/40 transition-all flex items-center justify-center gap-2 group"
              >
                <Scissors className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                Cut & Export GIF
              </button>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
};

export default App;