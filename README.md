# Pixel/24

Turn any image into a true 24 × 24 PNG constrained to a fixed 40-colour palette. Processing happens entirely in the browser, so uploaded images never leave the device.

## Features

- Drag-and-drop or file-picker image upload
- Exact 24 × 24 PNG output
- Fixed 40-colour nearest-colour matching
- Four approximation methods: Perceptual Lab, weighted RGB, RGB distance, and Floyd–Steinberg dithering
- Click-to-highlight palette colours with an exact pixel count
- Crop and contain modes
- Pixel-perfect enlarged preview
- One-click PNG download

## Run locally

```bash
npm install
npm run dev:pages
```

## Build for GitHub Pages

```bash
npm run build:pages
```

The included GitHub Actions workflow publishes the static build whenever `main` is updated.
