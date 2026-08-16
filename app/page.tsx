"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";

type FitMode = "cover" | "contain";
type ApproximationMethod = "lab" | "weighted" | "rgb" | "dither";
type SamplingMethod = "average" | "bilinear" | "bicubic" | "lanczos" | "centre" | "random";
type KernelSamplingMethod = Extract<SamplingMethod, "bilinear" | "bicubic" | "lanczos">;

const METHODS: Array<{ id: ApproximationMethod; label: string; detail: string }> = [
  { id: "lab", label: "PERCEPTUAL LAB", detail: "Matches colours by how different they look to the eye." },
  { id: "weighted", label: "WEIGHTED RGB", detail: "Balances red, green, and blue for a clean graphic result." },
  { id: "rgb", label: "RGB DISTANCE", detail: "Uses direct numerical distance between RGB values." },
  { id: "dither", label: "FLOYD–STEINBERG", detail: "Spreads colour error into neighbouring pixels for texture." },
];

const SAMPLING_METHODS: Array<{ id: SamplingMethod; label: string; detail: string; family: "antialias" | "point" }> = [
  { id: "average", label: "SMOOTH AVERAGE", detail: "Uses the browser’s high-quality area smoothing for a soft, balanced result.", family: "antialias" },
  { id: "bilinear", label: "BILINEAR", detail: "Uses a soft triangle filter to reduce jagged edges and high-frequency noise.", family: "antialias" },
  { id: "bicubic", label: "BICUBIC", detail: "Balances smooth edges with stronger contrast and clearer small features.", family: "antialias" },
  { id: "lanczos", label: "LANCZOS 3", detail: "Produces the sharpest antialiased result and preserves the most fine detail.", family: "antialias" },
  { id: "centre", label: "CENTRE POINT", detail: "Takes only the original pixel at the centre of each source box.", family: "point" },
  { id: "random", label: "RANDOM POINT", detail: "Takes one original pixel from a seeded random position in each box.", family: "point" },
];

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const PALETTE = [
  "#222222", "#B4B4B4", "#EAE7E0", "#FEFEFE", "#C33F3D", "#8F1F11", "#C32C4D", "#D9998F",
  "#F09D7D", "#F1D1C2", "#F9EEEA", "#F7F3E7", "#DBD2C9", "#DECFB0", "#C66834", "#C68B4F",
  "#E59D37", "#F2CB54", "#F7E4A2", "#B1B17F", "#C6D97F", "#6D6E20", "#A38C5A", "#A28E75",
  "#A5933D", "#3C2B17", "#6D4B26", "#504555", "#292444", "#3C4594", "#564496", "#B3A2CF",
  "#B7BCDC", "#A9ACBD", "#73A8B6", "#B7CED6", "#A1D6E4", "#64ACA0", "#BBD0C7", "#293660",
] as const;

function rgbToLab(red: number, green: number, blue: number): [number, number, number] {
  const linear = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const curve = (value: number) => value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  const fx = curve(x);
  const fy = curve(y);
  const fz = curve(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const PALETTE_RGB = PALETTE.map((hex) => {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return { hex, r, g, b, lab: rgbToLab(r, g, b) };
});

function findClosest(red: number, green: number, blue: number, method: Exclude<ApproximationMethod, "dither">) {
  let closest = PALETTE_RGB[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  const sourceLab = method === "lab" ? rgbToLab(red, green, blue) : null;

  for (const color of PALETTE_RGB) {
    const redDelta = red - color.r;
    const greenDelta = green - color.g;
    const blueDelta = blue - color.b;
    let distance: number;

    if (method === "lab" && sourceLab) {
      distance = (sourceLab[0] - color.lab[0]) ** 2
        + (sourceLab[1] - color.lab[1]) ** 2
        + (sourceLab[2] - color.lab[2]) ** 2;
    } else if (method === "weighted") {
      const redMean = (red + color.r) / 2;
      distance = (2 + redMean / 256) * redDelta ** 2
        + 4 * greenDelta ** 2
        + (2 + (255 - redMean) / 256) * blueDelta ** 2;
    } else {
      distance = redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2;
    }

    if (distance < closestDistance) {
      closest = color;
      closestDistance = distance;
    }
  }

  return closest;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const RESAMPLE_KERNELS: Record<KernelSamplingMethod, { support: number; sample: (distance: number) => number }> = {
  bilinear: {
    support: 1,
    sample: (distance) => Math.max(0, 1 - Math.abs(distance)),
  },
  bicubic: {
    support: 2,
    sample: (distance) => {
      const x = Math.abs(distance);
      if (x <= 1) return 1.5 * x ** 3 - 2.5 * x ** 2 + 1;
      if (x < 2) return -0.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2;
      return 0;
    },
  },
  lanczos: {
    support: 3,
    sample: (distance) => {
      const x = Math.abs(distance);
      if (x === 0) return 1;
      if (x >= 3) return 0;
      const piX = Math.PI * x;
      return (Math.sin(piX) / piX) * (Math.sin(piX / 3) / (piX / 3));
    },
  },
};

function makeResampleWeights(sourceSize: number, targetSize: number, method: KernelSamplingMethod) {
  const kernel = RESAMPLE_KERNELS[method];
  const sourcePerTarget = sourceSize / targetSize;
  const filterScale = Math.max(1, sourcePerTarget);

  return Array.from({ length: targetSize }, (_, targetIndex) => {
    const centre = (targetIndex + 0.5) * sourcePerTarget - 0.5;
    const radius = kernel.support * filterScale;
    const start = Math.max(0, Math.ceil(centre - radius));
    const end = Math.min(sourceSize - 1, Math.floor(centre + radius));
    const weights: Array<{ index: number; weight: number }> = [];
    let total = 0;

    for (let sourceIndex = start; sourceIndex <= end; sourceIndex += 1) {
      const weight = kernel.sample((sourceIndex - centre) / filterScale);
      if (weight === 0) continue;
      weights.push({ index: sourceIndex, weight });
      total += weight;
    }

    if (Math.abs(total) < 1e-8) {
      return [{ index: Math.max(0, Math.min(sourceSize - 1, Math.round(centre))), weight: 1 }];
    }

    return weights.map(({ index, weight }) => ({ index, weight: weight / total }));
  });
}

function drawKernelSampledImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: { x: number; y: number; width: number; height: number },
  destination: { x: number; y: number; width: number; height: number },
  method: KernelSamplingMethod,
) {
  const maxSourceDimension = 1024;
  const sourceScale = Math.min(1, maxSourceDimension / Math.max(source.width, source.height));
  const sourceWidth = Math.max(1, Math.round(source.width * sourceScale));
  const sourceHeight = Math.max(1, Math.round(source.height * sourceScale));
  const targetWidth = Math.max(1, Math.min(24, Math.round(destination.width)));
  const targetHeight = Math.max(1, Math.min(24, Math.round(destination.height)));

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) return false;

  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = "high";
  sourceContext.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const horizontalWeights = makeResampleWeights(sourceWidth, targetWidth, method);
  const verticalWeights = makeResampleWeights(sourceHeight, targetHeight, method);
  const horizontal = new Float32Array(targetWidth * sourceHeight * 4);

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const targetIndex = (y * targetWidth + targetX) * 4;
      for (const { index: sourceX, weight } of horizontalWeights[targetX]) {
        const sourceIndex = (y * sourceWidth + sourceX) * 4;
        const alpha = sourcePixels[sourceIndex + 3] / 255;
        horizontal[targetIndex] += sourcePixels[sourceIndex] * alpha * weight;
        horizontal[targetIndex + 1] += sourcePixels[sourceIndex + 1] * alpha * weight;
        horizontal[targetIndex + 2] += sourcePixels[sourceIndex + 2] * alpha * weight;
        horizontal[targetIndex + 3] += alpha * weight;
      }
    }
  }

  const output = ctx.createImageData(targetWidth, targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const outputIndex = (targetY * targetWidth + x) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (const { index: sourceY, weight } of verticalWeights[targetY]) {
        const horizontalIndex = (sourceY * targetWidth + x) * 4;
        red += horizontal[horizontalIndex] * weight;
        green += horizontal[horizontalIndex + 1] * weight;
        blue += horizontal[horizontalIndex + 2] * weight;
        alpha += horizontal[horizontalIndex + 3] * weight;
      }

      const visibleAlpha = Math.max(0, Math.min(1, alpha));
      output.data[outputIndex] = visibleAlpha > 1e-6 ? Math.max(0, Math.min(255, Math.round(red / alpha))) : 0;
      output.data[outputIndex + 1] = visibleAlpha > 1e-6 ? Math.max(0, Math.min(255, Math.round(green / alpha))) : 0;
      output.data[outputIndex + 2] = visibleAlpha > 1e-6 ? Math.max(0, Math.min(255, Math.round(blue / alpha))) : 0;
      output.data[outputIndex + 3] = Math.round(visibleAlpha * 255);
    }
  }

  const targetX = Math.max(0, Math.min(24 - targetWidth, Math.round(destination.x + (destination.width - targetWidth) / 2)));
  const targetY = Math.max(0, Math.min(24 - targetHeight, Math.round(destination.y + (destination.height - targetHeight) / 2)));
  ctx.putImageData(output, targetX, targetY);
  return true;
}

function drawSampledImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  fit: FitMode,
  sampling: SamplingMethod,
  seed: number,
) {
  ctx.clearRect(0, 0, 24, 24);

  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  const containScale = Math.min(24 / image.naturalWidth, 24 / image.naturalHeight);
  const source = fit === "cover"
    ? { x: (image.naturalWidth - crop) / 2, y: (image.naturalHeight - crop) / 2, width: crop, height: crop }
    : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const destination = fit === "cover"
    ? { x: 0, y: 0, width: 24, height: 24 }
    : {
        x: (24 - image.naturalWidth * containScale) / 2,
        y: (24 - image.naturalHeight * containScale) / 2,
        width: image.naturalWidth * containScale,
        height: image.naturalHeight * containScale,
      };

  if (sampling === "average") {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
    return;
  }

  if (sampling === "bilinear" || sampling === "bicubic" || sampling === "lanczos") {
    if (drawKernelSampledImage(ctx, image, source, destination, sampling)) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, source.x, source.y, source.width, source.height, destination.x, destination.y, destination.width, destination.height);
    return;
  }

  const random = seededRandom(seed);
  ctx.imageSmoothingEnabled = false;

  for (let outputY = 0; outputY < 24; outputY += 1) {
    for (let outputX = 0; outputX < 24; outputX += 1) {
      if (
        outputX + 1 <= destination.x
        || outputX >= destination.x + destination.width
        || outputY + 1 <= destination.y
        || outputY >= destination.y + destination.height
      ) continue;

      const uStart = Math.max(0, (outputX - destination.x) / destination.width);
      const uEnd = Math.min(1, (outputX + 1 - destination.x) / destination.width);
      const vStart = Math.max(0, (outputY - destination.y) / destination.height);
      const vEnd = Math.min(1, (outputY + 1 - destination.y) / destination.height);
      const u = sampling === "centre" ? (uStart + uEnd) / 2 : uStart + (uEnd - uStart) * random();
      const v = sampling === "centre" ? (vStart + vEnd) / 2 : vStart + (vEnd - vStart) * random();
      const sourceX = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(source.x + u * source.width)));
      const sourceY = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(source.y + v * source.height)));

      ctx.drawImage(image, sourceX, sourceY, 1, 1, outputX, outputY, 1, 1);
    }
  }
}

function applyPalette(ctx: CanvasRenderingContext2D, method: ApproximationMethod) {
  const imageData = ctx.getImageData(0, 0, 24, 24);
  const mappedColors = Array<string>(24 * 24).fill("");

  if (method === "dither") {
    const working = new Float32Array(imageData.data);
    const spreadError = (x: number, y: number, error: [number, number, number], weight: number) => {
      if (x < 0 || x >= 24 || y < 0 || y >= 24) return;
      const index = (y * 24 + x) * 4;
      if (imageData.data[index + 3] === 0) return;
      working[index] += error[0] * weight;
      working[index + 1] += error[1] * weight;
      working[index + 2] += error[2] * weight;
    };

    for (let y = 0; y < 24; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        const index = (y * 24 + x) * 4;
        if (imageData.data[index + 3] === 0) continue;
        const red = Math.max(0, Math.min(255, working[index]));
        const green = Math.max(0, Math.min(255, working[index + 1]));
        const blue = Math.max(0, Math.min(255, working[index + 2]));
        const closest = findClosest(red, green, blue, "weighted");
        const error: [number, number, number] = [red - closest.r, green - closest.g, blue - closest.b];

        imageData.data[index] = closest.r;
        imageData.data[index + 1] = closest.g;
        imageData.data[index + 2] = closest.b;
        mappedColors[index / 4] = closest.hex;

        spreadError(x + 1, y, error, 7 / 16);
        spreadError(x - 1, y + 1, error, 3 / 16);
        spreadError(x, y + 1, error, 5 / 16);
        spreadError(x + 1, y + 1, error, 1 / 16);
      }
    }
  } else {
    for (let index = 0; index < imageData.data.length; index += 4) {
      if (imageData.data[index + 3] === 0) continue;
      const closest = findClosest(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2], method);
      imageData.data[index] = closest.r;
      imageData.data[index + 1] = closest.g;
      imageData.data[index + 2] = closest.b;
      mappedColors[index / 4] = closest.hex;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return mappedColors;
}

function formatBytes(dataUrl: string) {
  const bytes = Math.max(0, Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75));
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function Home() {
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [fileName, setFileName] = useState("pixel-24");
  const [fit, setFit] = useState<FitMode>("cover");
  const [method, setMethod] = useState<ApproximationMethod>("lab");
  const [sampling, setSampling] = useState<SamplingMethod>("average");
  const [randomSeed, setRandomSeed] = useState(1729);
  const [pixelColors, setPixelColors] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pixelate = useCallback((
    imageSource: string,
    mode: FitMode,
    approximation: ApproximationMethod,
    samplingMethod: SamplingMethod,
    sampleSeed: number,
  ) => {
    if (!imageSource) return;

    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      drawSampledImage(ctx, image, mode, samplingMethod, sampleSeed);
      setPixelColors(applyPalette(ctx, approximation));
      setResult(canvas.toDataURL("image/png"));
    };
    image.src = imageSource;
  }, []);

  useEffect(() => {
    pixelate(source, fit, method, sampling, randomSeed);
  }, [source, fit, method, sampling, randomSeed, pixelate]);

  const selectedCount = selectedColor
    ? pixelColors.filter((color) => color === selectedColor).length
    : 0;
  const activeMethod = METHODS.find((option) => option.id === method) ?? METHODS[0];
  const activeSampling = SAMPLING_METHODS.find((option) => option.id === sampling) ?? SAMPLING_METHODS[0];

  const loadFile = (file?: File) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG, WebP, or GIF image.");
      return;
    }

    setError("");
    setFileName(file.name.replace(/\.[^.]+$/, "") || "pixel-24");
    const reader = new FileReader();
    reader.onload = () => setSource(String(reader.result));
    reader.onerror = () => setError("That image could not be read. Try another one.");
    reader.readAsDataURL(file);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  };

  const reset = () => {
    setSource("");
    setResult("");
    setPixelColors([]);
    setSelectedColor(null);
    setError("");
    setFileName("pixel-24");
  };

  return (
    <main className={source ? "has-source" : ""}>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="明日方舟拼豆生成器首页">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          <span>明日方舟拼豆生成器</span>
        </a>
        <span className="header-note">40-COLOUR LOCKED · LOCAL ONLY</span>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow"><span>01</span> Tiny image machine</p>
          <h1>Any image.<br /><em>24 × 24 pixels.</em></h1>
        </div>
        <p className="intro">
          Drop in a photo, illustration, or icon. We’ll reduce it to your
          40-colour palette and export a true 24 × 24 PNG.
        </p>
      </section>

      <section className="workspace" aria-label="明日方舟拼豆生成器">
        <div className="panel source-panel">
          <div className="panel-heading">
            <span><b>1</b> {source ? "PALETTE" : "SOURCE"}</span>
            {source && <button className="text-button" type="button" onClick={reset}>CLEAR</button>}
          </div>

          {source ? (
            <div className="palette-panel">
              <div className="source-summary">
                <img src={source} alt="Uploaded source thumbnail" />
                <div>
                  <strong>{fileName}</strong>
                  <span>IMAGE LOADED · 40 COLOURS</span>
                </div>
                <button type="button" onClick={() => inputRef.current?.click()}>REPLACE</button>
              </div>
              <p className="palette-instruction">Click a colour to isolate its pixels in the output preview.</p>
              <div className="palette-grid compact-palette" aria-label="40 available colours">
                {PALETTE.map((color, index) => (
                  <button
                    type="button"
                    key={color}
                    className={selectedColor === color ? "is-selected" : ""}
                    style={{ backgroundColor: color }}
                    title={`${index + 1}: ${color}`}
                    aria-label={`Colour ${index + 1}, ${color}${selectedColor === color ? ", highlighted" : ""}`}
                    aria-pressed={selectedColor === color}
                    onClick={() => setSelectedColor((current) => current === color ? null : color)}
                  >
                    <i>{String(index + 1).padStart(2, "0")}</i>
                  </button>
                ))}
              </div>
              <div className={`highlight-status ${selectedColor ? "is-active" : ""}`} aria-live="polite">
                {selectedColor ? (
                  <>
                    <span className="selected-swatch" style={{ backgroundColor: selectedColor }} aria-hidden="true" />
                    <strong>{selectedColor}</strong>
                    <span>{`${selectedCount} pixel${selectedCount === 1 ? "" : "s"} highlighted`}</span>
                    <button type="button" onClick={() => setSelectedColor(null)}>CLEAR</button>
                  </>
                ) : (
                  <><b aria-hidden="true">↗</b><span>SELECT A COLOUR TO HIGHLIGHT</span></>
                )}
              </div>
            </div>
          ) : (
            <div
              className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <label className="upload-prompt" htmlFor="image-upload">
                <span className="upload-glyph" aria-hidden="true">↗</span>
                <strong>DROP IMAGE HERE</strong>
                <span>or click to browse</span>
                <small>JPG, PNG, WEBP OR GIF</small>
              </label>
            </div>
          )}
          <input
            ref={inputRef}
            className="file-input"
            id="image-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleInput}
          />
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <div className="panel result-panel">
          <div className="panel-heading">
            <span><b>2</b> OUTPUT</span>
            <span className="status-dot"><i /> 24 × 24 · 40 COLOURS</span>
          </div>

          <div className="result-stage">
            <span className="dimension dimension-top">24 PX</span>
            <span className="dimension dimension-side">24 PX</span>
            <div className={`pixel-frame ${selectedColor ? "is-highlighting" : ""}`}>
              {result ? (
                <>
                  <img className="pixel-image" src={result} alt="24 by 24 pixel result" />
                  {selectedColor && (
                    <div className="pixel-highlight-grid" aria-hidden="true">
                      {pixelColors.map((color, index) => (
                        <i
                          key={index}
                          className={color === selectedColor ? "match" : ""}
                          style={color === selectedColor ? { backgroundColor: selectedColor } : undefined}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-pixels" aria-label="Your pixelated result will appear here">
                  {Array.from({ length: 64 }, (_, index) => <i key={index} />)}
                  <span>24</span>
                </div>
              )}
            </div>
          </div>

          <div className="method-control sampling-control">
            <label htmlFor="sampling-method">SAMPLING / AA</label>
            <div className="select-wrap">
              <select
                id="sampling-method"
                value={sampling}
                onChange={(event) => setSampling(event.target.value as SamplingMethod)}
              >
                <optgroup label="ANTI-ALIASED">
                  {SAMPLING_METHODS.filter((option) => option.family === "antialias").map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </optgroup>
                <optgroup label="SINGLE-POINT">
                  {SAMPLING_METHODS.filter((option) => option.family === "point").map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </optgroup>
              </select>
              <span aria-hidden="true">⌄</span>
            </div>
            <p>{activeSampling.detail}</p>
            {sampling === "random" && (
              <button
                className="resample-button"
                type="button"
                onClick={() => setRandomSeed((current) => (Math.imul(current, 1664525) + 1013904223) >>> 0)}
              >
                NEW RANDOM SAMPLE <b aria-hidden="true">↻</b>
              </button>
            )}
          </div>

          <div className="method-control approximation-control">
            <label htmlFor="approximation-method">APPROXIMATION</label>
            <div className="select-wrap">
              <select
                id="approximation-method"
                value={method}
                onChange={(event) => setMethod(event.target.value as ApproximationMethod)}
              >
                {METHODS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <span aria-hidden="true">⌄</span>
            </div>
            <p>{activeMethod.detail}</p>
          </div>

          <div className="controls">
            <span className="control-label">FIT</span>
            <div className="segmented" role="group" aria-label="Image fit">
              <button type="button" className={fit === "cover" ? "active" : ""} onClick={() => setFit("cover")}>CROP</button>
              <button type="button" className={fit === "contain" ? "active" : ""} onClick={() => setFit("contain")}>CONTAIN</button>
            </div>
            <span className="file-size">{result ? formatBytes(result) : "— KB"}</span>
          </div>

          {result ? (
            <a className="download-button" href={result} download={`${fileName}-24x24.png`}>
              <span>DOWNLOAD PNG</span><b>↓</b>
            </a>
          ) : (
            <button className="download-button" type="button" disabled>
              <span>ADD AN IMAGE TO START</span><b>↓</b>
            </button>
          )}
          <canvas ref={canvasRef} width="24" height="24" aria-hidden="true" />
        </div>
      </section>

      <footer>
        <p>Your image never leaves this page.</p>
        <p>MADE FOR SMALL THINGS <span aria-hidden="true">■</span></p>
      </footer>
    </main>
  );
}
