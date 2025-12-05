import { parseGIF, decompressFrames } from 'gifuct-js';
import GIF from 'gif.js.optimized';

// Helper to fetch the worker script as a blob to avoid external file dependency issues in some environments
const getWorkerBlobUrl = async () => {
  const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

export const loadGifFrames = async (file: File): Promise<any[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const gif = parseGIF(arrayBuffer);
  const frames = decompressFrames(gif, true);
  return frames;
};

// We use Green as the Chroma Key for transparency.
// This prevents 'black' pixels inside the image from accidentally becoming transparent.
// If the image itself contains this exact green, it will become transparent, but it's a standard trade-off.
const CHROMA_KEY_COLOR_HEX = 0x00FF00;
const CHROMA_KEY_COLOR_STR = '#00FF00';

export const processGifRobust = async (
    rawFrames: any[],
    points: { x: number; y: number }[],
    originalWidth: number,
    originalHeight: number,
    targetWidth: number,
    targetHeight: number,
    onProgress: (progress: number) => void,
    frameSkip: number = 1,
    quality: number = 10 // Lower is better (1-30). Higher = faster but worse sampling.
  ): Promise<Blob> => {
    const workerScriptUrl = await getWorkerBlobUrl();
    
    const gif = new GIF({
      workers: 2,
      quality: quality,
      width: targetWidth,
      height: targetHeight,
      workerScript: workerScriptUrl,
      transparent: CHROMA_KEY_COLOR_HEX, // Tell gif.js to make Green pixels transparent
      background: '#000000'
    });
  
    // Canvas to maintain the full "state" of the animation (Original Size)
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = originalWidth;
    fullCanvas.height = originalHeight;
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
    if (!fullCtx) throw new Error('Context error');
  
    // Canvas for the final cropped output (Target Size)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!exportCtx) throw new Error('Context error');
  
    // Temp canvas for the current raw patch
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = originalWidth;
    patchCanvas.height = originalHeight;
    const patchCtx = patchCanvas.getContext('2d');
    if (!patchCtx) throw new Error('Context error');

    // Calculate Scale
    const scaleX = targetWidth / originalWidth;
    const scaleY = targetHeight / originalHeight;
  
    let frameIndex = 0;
  
    for (let i = 0; i < rawFrames.length; i++) {
      onProgress(frameIndex / rawFrames.length);
      frameIndex++;

      const frame = rawFrames[i];
      
      // 1. Draw the patch to maintain state (Must happen for EVERY frame, even skipped ones)
      const dims = frame.dims;
      const imageData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        dims.width,
        dims.height
      );
      
      patchCanvas.width = dims.width;
      patchCanvas.height = dims.height;
      patchCtx.putImageData(imageData, 0, 0);
  
      // Composite onto full canvas (Handle disposal logic roughly)
      if (frame.disposalType === 2) {
         fullCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
      }
      
      fullCtx.drawImage(patchCanvas, dims.left, dims.top);

      // 2. Decide if we keep this frame based on frameSkip
      if (i % frameSkip === 0) {
        // Calculate delay: Sum delays of this frame AND any skipped frames following it
        let delay = 0;
        for (let j = 0; j < frameSkip && (i + j) < rawFrames.length; j++) {
          delay += rawFrames[i + j].delay;
        }

        // 3. Create the cropped version
        
        // Step A: Fill the export canvas with the Chroma Key Green
        exportCtx.fillStyle = CHROMA_KEY_COLOR_STR;
        exportCtx.fillRect(0, 0, targetWidth, targetHeight);
        
        exportCtx.save();
        
        // Apply scaling: transform subsequent drawing commands to target size
        exportCtx.scale(scaleX, scaleY);

        exportCtx.beginPath();
        if (points.length > 0) {
          exportCtx.moveTo(points[0].x, points[0].y);
          for (let k = 1; k < points.length; k++) {
            exportCtx.lineTo(points[k].x, points[k].y);
          }
          exportCtx.closePath();
        }
        // Step B: Clip to the shape (scaled)
        exportCtx.clip();
        
        // Step C: Draw the image (scaled)
        exportCtx.drawImage(fullCanvas, 0, 0);
        
        exportCtx.restore();
    
        // 4. Add to GIF
        gif.addFrame(exportCtx, {
          delay: delay,
          copy: true,
        });
      }
    }
  
    onProgress(1.0);
  
    return new Promise((resolve, reject) => {
      gif.on('finished', (blob: Blob) => {
        resolve(blob);
      });
      gif.render();
    });
  };