import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

// Regenerate icons with `npm run icons` after changing public/logo.svg
export default defineConfig({
  preset,
  images: ['public/logo.svg'],
})
