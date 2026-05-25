import { withMermaid } from "vitepress-plugin-mermaid";
import llmstxt, { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

const base = process.env.DOCS_BASE ?? "/Ident/";

export default withMermaid({
  title: "Ident",
  description:
    "Documentation for Ident, a receiver-local ADS-B display: how it works, how to run it, and how to contribute.",
  base,
  head: [
    ["link", { rel: "icon", href: `${base}favicon.ico`, sizes: "48x48" }],
    ["link", { rel: "icon", href: `${base}icon.svg`, type: "image/svg+xml" }],
  ],
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ["AGENTS.md", "CLAUDE.md"],
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  vite: {
    // Root-level llms.txt / llms-full.txt are not generated: serving them from
    // the site root does not follow RFC 8615 (well-known URIs). Per-page Markdown
    // is still emitted so the copy/download buttons work.
    plugins: [
      llmstxt({
        generateLLMsTxt: false,
        generateLLMsFullTxt: false,
        generateLLMFriendlyDocsForEachPage: true,
      }),
    ],
    optimizeDeps: {
      include: ["mermaid", "dayjs"],
    },
    ssr: {
      noExternal: ["mermaid"],
    },
  },
  themeConfig: {
    logo: "/icon.svg",
    nav: [
      { text: "Overview", link: "/" },
      { text: "Install", link: "/getting-started/install" },
      { text: "Architecture", link: "/architecture" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Ident-1090/Ident" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Overview", link: "/" },
          { text: "System Architecture", link: "/architecture" },
        ],
      },
      {
        text: "Getting Started",
        items: [
          { text: "Install", link: "/getting-started/install" },
          { text: "Configuration", link: "/getting-started/configuration" },
        ],
      },
      {
        text: "Backend (identd)",
        items: [
          { text: "Producer Normalization", link: "/backend/producer-normalization" },
          { text: "Live Transport", link: "/backend/live-transport" },
          { text: "Aircraft Trails", link: "/backend/trails" },
          { text: "Replay History", link: "/backend/replay" },
          { text: "Diagnostics", link: "/backend/diagnostics" },
        ],
      },
      {
        text: "Frontend",
        items: [
          { text: "Map & Rendering", link: "/frontend/map-rendering" },
          { text: "Trails & Replay Playback", link: "/frontend/trails-replay" },
        ],
      },
      {
        text: "Operations",
        items: [
          { text: "Deployment & Packaging", link: "/operations/deployment" },
          { text: "Security Posture", link: "/operations/security" },
        ],
      },
      {
        text: "Bundling Ident",
        items: [
          { text: "The container image", link: "/bundling/container-image" },
        ],
      },
      {
        text: "Development",
        items: [{ text: "Development", link: "/development" }],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
  },
});
