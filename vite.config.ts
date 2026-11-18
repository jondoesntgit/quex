import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Link previews (iMessage, Discord, Slack, Facebook) want absolute URLs for
 *  og:image / og:url. Set VITE_SITE_URL (e.g. https://quex.example.workers.dev)
 *  as a build variable; without it the tags fall back to relative paths. */
function siteUrl(url: string): Plugin {
  const base = url.replace(/\/+$/, '')
  return { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', base) }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return { plugins: [react(), siteUrl(env.VITE_SITE_URL ?? '')] }
})
