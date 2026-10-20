import { defineConfig, type Preset } from '@vite-pwa/assets-generator/config'

/** The edge color of the logo's background, so full-bleed icons have no seam */
const NAVY = '#0b1533'

// The artwork already sits inside the maskable safe zone, so no icon gets extra padding
const preset: Preset = {
  transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']], padding: 0 },
  maskable: { sizes: [512], padding: 0, resizeOptions: { background: NAVY } },
  apple: { sizes: [180], padding: 0, resizeOptions: { background: NAVY } },
  // The default quality (60) bands the background gradient
  png: { compressionLevel: 9, quality: 95 },
}

// Regenerate icons with `npm run icons` after changing public/logo.svg
export default defineConfig({
  preset,
  images: ['public/logo.svg'],
})
