import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Link previews (iMessage, Discord, Slack, Facebook) want absolute URLs for
 *  og:image / og:url. Set VITE_SITE_URL (e.g. https://quex.example.workers.dev)
 *  as a build variable; without it the tags fall back to relative paths. */
function siteUrl(url: string): Plugin {
  const base = url.replace(/\/+$/, '')
  return { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', base) }
}

/** The commit this build was made from (shown at the bottom of the Help page). */
function commit(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'dev' }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), siteUrl(env.VITE_SITE_URL ?? '')],
    define: { __BUILD_COMMIT__: JSON.stringify(commit()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  }
})
