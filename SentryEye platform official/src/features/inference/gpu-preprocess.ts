// GPU-resident preprocessing.
//
// The CPU path costs a getImageData() plus a 3·imgsz² JavaScript write loop per
// frame — ~2.8 M float writes at 960px, which is what capped the 960 model at
// ~3 FPS regardless of the execution provider. Here the camera frame is copied
// straight into a GPU texture and a compute shader performs letterbox + gain +
// normalise + NCHW planarisation directly into a GPUBuffer that ORT consumes
// with Tensor.fromGpuBuffer. No pixel ever touches CPU memory.
//
// Everything here is best-effort: any failure lets the worker fall back to the
// CPU path, which stays correct on every device.

export interface GpuGeometry {
  scale: number;
  scaleX: number;
  scaleY: number;
  padX: number;
  padY: number;
  srcW: number;
  srcH: number;
}

const WGSL = /* wgsl */ `
struct Params {
  imgsz : u32,
  srcW  : u32,
  srcH  : u32,
  dstW  : u32,
  dstH  : u32,
  padX  : u32,
  padY  : u32,
  imagenet : u32,
  gain  : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;
@group(0) @binding(2) var<storage, read_write> out : array<f32>;
@group(0) @binding(3) var<uniform> p : Params;

const MEAN = vec3<f32>(0.485, 0.456, 0.406);
const STD  = vec3<f32>(0.229, 0.224, 0.225);
const PAD  = vec3<f32>(0.447, 0.447, 0.447); // 114/255

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= p.imgsz || y >= p.imgsz) { return; }

  var rgb = PAD;
  if (x >= p.padX && y >= p.padY && x < p.padX + p.dstW && y < p.padY + p.dstH) {
    let u = (f32(x - p.padX) + 0.5) / f32(p.dstW);
    let v = (f32(y - p.padY) + 0.5) / f32(p.dstH);
    rgb = textureSampleLevel(srcTex, srcSampler, vec2<f32>(u, v), 0.0).rgb;
    rgb = min(rgb * p.gain, vec3<f32>(1.0, 1.0, 1.0));
  }

  if (p.imagenet == 1u) {
    rgb = (rgb - MEAN) / STD;
  }

  let plane = p.imgsz * p.imgsz;
  let idx = y * p.imgsz + x;
  out[idx] = rgb.r;
  out[idx + plane] = rgb.g;
  out[idx + 2u * plane] = rgb.b;
}
`;

type GPUDeviceLike = GPUDevice;

// The WebGPU usage flag enums are runtime globals that this project's TS lib
// does not declare, so the bit values are spelled out here.
const BUFFER_UNIFORM = 0x0040;
const BUFFER_STORAGE = 0x0080;
const BUFFER_COPY_SRC = 0x0004;
const BUFFER_COPY_DST = 0x0008;
const TEXTURE_COPY_DST = 0x0002;
const TEXTURE_BINDING = 0x0004;
const TEXTURE_RENDER_ATTACHMENT = 0x0010;


export class GpuPreprocessor {
  private pipeline: GPUComputePipeline;
  private sampler: GPUSampler;
  private uniform: GPUBuffer;
  private texture: GPUTexture | null = null;
  private texW = 0;
  private texH = 0;
  private bindGroup: GPUBindGroup | null = null;
  /** NCHW float32 tensor buffer, reused for the session's lifetime. */
  readonly buffer: GPUBuffer;

  private constructor(
    private device: GPUDeviceLike,
    private imgsz: number,
    pipeline: GPUComputePipeline,
  ) {
    this.pipeline = pipeline;
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.uniform = device.createBuffer({
      size: 48,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
    });
    this.buffer = device.createBuffer({
      size: 3 * imgsz * imgsz * 4,
      usage: BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST,
    });

  }

  static create(device: GPUDeviceLike, imgsz: number): GpuPreprocessor {
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    return new GpuPreprocessor(device, imgsz, pipeline);
  }

  private ensureTexture(w: number, h: number) {
    if (this.texture && this.texW === w && this.texH === h) return;
    this.texture?.destroy();
    this.texture = this.device.createTexture({
      size: [w, h, 1],
      format: "rgba8unorm",
      usage:
        TEXTURE_COPY_DST |
        TEXTURE_BINDING |
        TEXTURE_RENDER_ATTACHMENT,

    });
    this.texW = w;
    this.texH = h;
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.buffer } },
        { binding: 3, resource: { buffer: this.uniform } },
      ],
    });
  }

  /**
   * Upload one frame and run the conversion. Returns the letterbox geometry the
   * decoder needs to map boxes back into source pixels.
   */
  run(
    frame: ImageBitmap,
    opts: { resize: "letterbox" | "stretch"; normalize: "unit" | "imagenet"; gain: number },
  ): GpuGeometry {
    const srcW = frame.width;
    const srcH = frame.height;
    const imgsz = this.imgsz;
    this.ensureTexture(srcW, srcH);

    let scale = 1;
    let dstW = imgsz;
    let dstH = imgsz;
    let padX = 0;
    let padY = 0;
    if (opts.resize === "letterbox") {
      scale = Math.min(imgsz / srcW, imgsz / srcH);
      dstW = Math.round(srcW * scale);
      dstH = Math.round(srcH * scale);
      padX = Math.floor((imgsz - dstW) / 2);
      padY = Math.floor((imgsz - dstH) / 2);
    }

    this.device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture: this.texture! },
      [srcW, srcH, 1],
    );

    const params = new ArrayBuffer(48);
    const u = new Uint32Array(params);
    const f = new Float32Array(params);
    u[0] = imgsz;
    u[1] = srcW;
    u[2] = srcH;
    u[3] = dstW;
    u[4] = dstH;
    u[5] = padX;
    u[6] = padY;
    u[7] = opts.normalize === "imagenet" ? 1 : 0;
    f[8] = opts.gain > 0 ? opts.gain : 1;
    this.device.queue.writeBuffer(this.uniform, 0, params);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    const groups = Math.ceil(imgsz / 8);
    pass.dispatchWorkgroups(groups, groups, 1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return {
      scale,
      scaleX: opts.resize === "letterbox" ? scale : imgsz / srcW,
      scaleY: opts.resize === "letterbox" ? scale : imgsz / srcH,
      padX,
      padY,
      srcW,
      srcH,
    };
  }

  dispose() {
    this.texture?.destroy();
    this.texture = null;
    this.buffer.destroy();
    this.uniform.destroy();
  }
}

/**
 * Mean scene luma without a GPU readback: draw the frame into a tiny canvas and
 * average that. 64×64 = 4096 pixels, ~0.1 ms, versus a full-frame readback that
 * would stall the pipeline.
 */
export function sampleLuma(
  frame: ImageBitmap,
  ctx: OffscreenCanvasRenderingContext2D,
): number {
  const size = ctx.canvas.width;
  ctx.drawImage(frame, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  let sum = 0;
  const px = size * size;
  for (let i = 0, p = 0; i < px; i++, p += 4) {
    sum += (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }
  return px ? sum / px : 0;
}
