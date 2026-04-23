import {
  defineConfig,
  minimal2023Preset,
  type Preset,
} from "@vite-pwa/assets-generator/config";

// Dark square backdrop matches --color-bg so Home Screen icons blend with
// the Night Ops theme. The maskable variant pads the plane glyph so OS-
// level squircle masks don't crop it.
const preset: Preset = {
  ...minimal2023Preset,
  transparent: {
    ...minimal2023Preset.transparent,
    sizes: [64, 192, 512],
    favicons: [[48, "favicon.ico"]],
  },
  maskable: {
    ...minimal2023Preset.maskable,
    sizes: [512],
    padding: 0.3,
    resizeOptions: {
      background: "#0f1113",
      fit: "contain",
    },
  },
  apple: {
    ...minimal2023Preset.apple,
    sizes: [180],
    padding: 0.3,
    resizeOptions: {
      background: "#0f1113",
      fit: "contain",
    },
  },
};

export default defineConfig({
  preset,
  images: ["public/icons/icon.svg"],
});
