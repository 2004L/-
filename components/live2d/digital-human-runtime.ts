"use client";

declare global {
  interface Window {
    loadlive2d?: (canvasId: string, modelPath: string) => void;
    playLive2DMotion?: (motionName: string, canvasId?: string) => unknown;
    initLive2DMotionManager?: () => void;
    Live2DMotionManager?: { init?: () => void };
  }
}

const loadedScripts = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const existing = loadedScripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Live2D runtime failed to load: ${src}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

export async function loadLive2DRuntime() {
  await loadScript("/live2d/runtime/live2d.js");
  await loadScript("/live2d/runtime/live2d-extensions.js");
  window.initLive2DMotionManager?.();
}

export function syncCanvasResolution(canvas: HTMLCanvasElement, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
}

export async function mountLive2DModel(canvas: HTMLCanvasElement, container: HTMLElement, modelPath: string) {
  await loadLive2DRuntime();
  syncCanvasResolution(canvas, container);
  if (typeof window.loadlive2d !== "function") throw new Error("Live2D loader is unavailable");
  window.loadlive2d(canvas.id, modelPath);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => syncCanvasResolution(canvas, container)) : null;
  observer?.observe(container);
  return () => observer?.disconnect();
}

export function playLive2DMotion(motion: string, canvasId: string) {
  if (!motion || typeof window.playLive2DMotion !== "function") return false;
  try {
    return window.playLive2DMotion(motion, canvasId);
  } catch (error) {
    console.warn("Live2D motion failed", motion, error);
    return false;
  }
}
