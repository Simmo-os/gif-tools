export interface Point {
  x: number;
  y: number;
  id: string;
}

export interface GifFrame {
  imageData: ImageData;
  delay: number;
  dims: {
    width: number;
    height: number;
    top: number;
    left: number;
  };
}

export enum ToolState {
  IDLE,
  DRAGGING,
  PROCESSING,
  COMPLETED
}

export interface Size {
  width: number;
  height: number;
}
