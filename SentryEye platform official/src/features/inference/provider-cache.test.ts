// Verifies the model-caching contract:
//  - a model is downloaded/compiled exactly once,
//  - repeated sessions (multiple videos, replays) reuse the warm provider,
//  - switching models disposes only the previous model and loads the new one once.

import { beforeEach, describe, expect, it, vi } from "vitest";

const created: MockProvider[] = [];

class MockProvider {
  id = "browser-onnx";
  initCalls = 0;
  disposeCalls = 0;
  reconfigureCalls = 0;
  constructor() {
    created.push(this);
  }
  async init() {
    this.initCalls += 1;
  }
  async infer() {
    return null;
  }
  reconfigure() {
    this.reconfigureCalls += 1;
  }
  status() {
    return { engine: "mock", fps: 0 };
  }
  async dispose() {
    this.disposeCalls += 1;
  }
}

class DeferredProvider extends MockProvider {
  private resolveInit: (() => void) | null = null;
  init() {
    this.initCalls += 1;
    return new Promise<void>((resolve) => {
      this.resolveInit = resolve;
    });
  }
  finishInit() {
    this.resolveInit?.();
  }
}

vi.mock("./registry", () => ({
  createProvider: vi.fn(() => new MockProvider()),
}));

const cfg = (modelId: string) =>
  ({
    modelId,
    modelUrl: `/models/${modelId}.onnx`,
    imgsz: 384,
    labels: {},
    semanticMap: {},
    confThreshold: 0.35,
    iouThreshold: 0.5,
    maxDetections: 100,
    modelName: modelId,
    modelVersion: "1.0.0",
    headFormat: "ultralytics-v8",
    classIdOffset: 0,
    resize: "letterbox",
    normalize: "unit",
  }) as never;

describe("provider cache", () => {
  let cache: typeof import("./provider-cache");

  beforeEach(async () => {
    vi.resetModules();
    created.length = 0;
    cache = await import("./provider-cache");
  });

  it("loads a model only once across repeated sessions", async () => {
    const a = await cache.acquireProvider("browser-onnx", cfg("model-a"));
    cache.releaseProvider(a);
    const b = await cache.acquireProvider("browser-onnx", cfg("model-a")); // second video
    cache.releaseProvider(b);
    const c = await cache.acquireProvider("browser-onnx", cfg("model-a")); // replay

    expect(created).toHaveLength(1);
    expect(created[0].initCalls).toBe(1);
    expect(created[0].disposeCalls).toBe(0);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(cache.isWarm("browser-onnx", "model-a")).toBe(true);
  });

  it("switching models disposes only the previous model and loads the new one once", async () => {
    const a = await cache.acquireProvider("browser-onnx", cfg("model-a"));
    cache.releaseProvider(a);

    await cache.disposeUnlessModel("model-b");
    expect(created[0].disposeCalls).toBe(1);
    expect(cache.isWarm("browser-onnx", "model-a")).toBe(false);

    const b = await cache.acquireProvider("browser-onnx", cfg("model-b"));
    cache.releaseProvider(b);
    const b2 = await cache.acquireProvider("browser-onnx", cfg("model-b"));

    expect(created).toHaveLength(2);
    expect(created[1].initCalls).toBe(1);
    expect(created[1].disposeCalls).toBe(0);
    expect(b).toBe(b2);
  });

  it("re-selecting the already warm model does not unload it", async () => {
    const a = await cache.acquireProvider("browser-onnx", cfg("model-a"));
    cache.releaseProvider(a);
    await cache.disposeUnlessModel("model-a");
    expect(created[0].disposeCalls).toBe(0);
    expect(cache.isWarm("browser-onnx", "model-a")).toBe(true);
  });

  it("keeps the provider while a session still owns it", async () => {
    await cache.acquireProvider("browser-onnx", cfg("model-a"));
    await cache.disposeUnlessModel("model-b"); // switch mid-session
    expect(created[0].disposeCalls).toBe(0);
  });

  it("evicts a free model when a different one is acquired", async () => {
    const a = await cache.acquireProvider("browser-onnx", cfg("model-a"));
    cache.releaseProvider(a);
    await cache.acquireProvider("browser-onnx", cfg("model-b"));
    expect(created[0].disposeCalls).toBe(1);
    expect(created[1].initCalls).toBe(1);
  });

  it("does not tear down an in-use provider mid-session, but disposes on release", async () => {
    const a = await cache.acquireProvider("browser-onnx", cfg("model-a"));
    await cache.acquireProvider("browser-onnx", cfg("model-b"));
    expect(created[0].disposeCalls).toBe(0);
    cache.releaseProvider(a);
    expect(created[0].disposeCalls).toBe(1);
  });

  it("applies threshold changes without reloading the model", async () => {
    await cache.acquireProvider("browser-onnx", cfg("model-a"));
    await cache.acquireProvider("browser-onnx", {
      ...(cfg("model-a") as object),
      confThreshold: 0.6,
    } as never);
    expect(created).toHaveLength(1);
    expect(created[0].reconfigureCalls).toBe(1);
  });

  it("does not report an initializing provider as warm", async () => {
    const provider = new DeferredProvider();
    const registry = await import("./registry");
    vi.mocked(registry.createProvider).mockReturnValueOnce(provider as never);
    const pending = cache.acquireProvider("browser-onnx", cfg("model-a"));
    expect(cache.isWarm("browser-onnx", "model-a")).toBe(false);
    provider.finishInit();
    await pending;
    expect(cache.isWarm("browser-onnx", "model-a")).toBe(true);
  });
});
