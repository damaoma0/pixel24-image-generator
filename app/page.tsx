"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";

type FitMode = "cover" | "contain";
type ApproximationMethod = "lab" | "weighted" | "rgb" | "dither";

const METHODS: Array<{ id: ApproximationMethod; label: string; detail: string }> = [
  { id: "lab", label: "PERCEPTUAL LAB", detail: "Matches colours by how different they look to the eye." },
  { id: "weighted", label: "WEIGHTED RGB", detail: "Balances red, green, and blue for a clean graphic result." },
  { id: "rgb", label: "RGB DISTANCE", detail: "Uses direct numerical distance between RGB values." },
  { id: "dither", label: "FLOYD–STEINBERG", detail: "Spreads colour error into neighbouring pixels for texture." },
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
  const [pixelColors, setPixelColors] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pixelate = useCallback((imageSource: string, mode: FitMode, approximation: ApproximationMethod) => {
    if (!imageSource) return;

    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, 24, 24);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (mode === "cover") {
        const crop = Math.min(image.naturalWidth, image.naturalHeight);
        const sx = (image.naturalWidth - crop) / 2;
        const sy = (image.naturalHeight - crop) / 2;
        ctx.drawImage(image, sx, sy, crop, crop, 0, 0, 24, 24);
      } else {
        const scale = Math.min(24 / image.naturalWidth, 24 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        ctx.drawImage(image, (24 - width) / 2, (24 - height) / 2, width, height);
      }

      setPixelColors(applyPalette(ctx, approximation));
      setResult(canvas.toDataURL("image/png"));
    };
    image.src = imageSource;
  }, []);

  useEffect(() => {
    pixelate(source, fit, method);
  }, [source, fit, method, pixelate]);

  const selectedCount = selectedColor
    ? pixelColors.filter((color) => color === selectedColor).length
    : 0;
  const activeMethod = METHODS.find((option) => option.id === method) ?? METHODS[0];

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
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Pixel 24 home">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          <span>PIXEL/24</span>
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

      <section className="workspace" aria-label="Pixel art generator">
        <div className="panel source-panel">
          <div className="panel-heading">
            <span><b>1</b> SOURCE</span>
            {source && <button className="text-button" type="button" onClick={reset}>CLEAR</button>}
          </div>

          <div
            className={`drop-zone ${isDragging ? "is-dragging" : ""} ${source ? "has-image" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {source ? (
              <img className="source-image" src={source} alt="Uploaded source" />
            ) : (
              <label className="upload-prompt" htmlFor="image-upload">
                <span className="upload-glyph" aria-hidden="true">↗</span>
                <strong>DROP IMAGE HERE</strong>
                <span>or click to browse</span>
                <small>JPG, PNG, WEBP OR GIF</small>
              </label>
            )}
            <input
              ref={inputRef}
              id="image-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleInput}
            />
          </div>

          {source && (
            <button className="replace-button" type="button" onClick={() => inputRef.current?.click()}>
              CHOOSE ANOTHER IMAGE
            </button>
          )}
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

          <div className="method-control">
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

      <section className="palette-section" aria-labelledby="palette-title">
        <div className="palette-copy">
          <p className="eyebrow"><span>02</span> Locked colour system</p>
          <h2 id="palette-title">Your 40-colour palette.</h2>
          <p>Every visible pixel is matched to the nearest colour below. Click a colour to isolate its pixels in the preview.</p>
          <div className={`highlight-status ${selectedColor ? "is-active" : ""}`} aria-live="polite">
            {selectedColor ? (
              <>
                <span className="selected-swatch" style={{ backgroundColor: selectedColor }} aria-hidden="true" />
                <strong>{selectedColor}</strong>
                <span>{result ? `${selectedCount} pixel${selectedCount === 1 ? "" : "s"} highlighted` : "Upload an image to see matches"}</span>
                <button type="button" onClick={() => setSelectedColor(null)}>CLEAR</button>
              </>
            ) : (
              <><b aria-hidden="true">↙</b><span>SELECT A COLOUR TO HIGHLIGHT</span></>
            )}
          </div>
        </div>
        <div className="palette-grid" aria-label="40 available colours">
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
      </section>

      <footer>
        <p>Your image never leaves this page.</p>
        <p>MADE FOR SMALL THINGS <span aria-hidden="true">■</span></p>
      </footer>
    </main>
  );
}
