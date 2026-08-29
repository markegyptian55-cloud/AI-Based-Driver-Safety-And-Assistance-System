// Generic FrameSource contract. Any input (webcam, uploaded video, screen
// capture, remote stream) implements this so the orchestrator hook stays
// input-agnostic.

export type FrameSourceHandler = (bitmap: ImageBitmap, ts: number) => Promise<void>;

export interface FrameSource {
  start(): Promise<void>;
  stop(): void;
  /** Frames delivered by the underlying source (raw FPS). */
  sourceFps(): number;
  /** Frames actually forwarded to the provider after adaptive skipping. */
  processedFps(): number;
  /** Total frames delivered by the source, including skipped ones. */
  totalFrames?(): number;
  /** Total frames actually forwarded to the provider. */
  analysedFrames?(): number;
  /** Current adaptive inference budget in FPS, when the source throttles. */
  targetInferenceFps?(): number;
  /** Frames captured and waiting for a free pipeline slot right now. */
  queuedFrames?(): number;
  /** Frames currently inside the pipeline (submitted, no result yet). */
  inFlightFrames?(): number;
  /** How many frames the source is allowed to keep in flight. */
  pipelineDepth?(): number;
  /** Source frames intentionally not analysed, as a 0..1 ratio. */
  dropRate?(): number;
  /** Longest side the source currently captures at (adaptive downscale). */
  captureHeight?(): number;
  /** Optional: whether the source has finished naturally (e.g. video ended). */
  isEnded?(): boolean;
}
