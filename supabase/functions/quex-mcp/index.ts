// Quex MCP server (QUEX-33): lets Claude, ChatGPT or any MCP client read and
// plan a player's daily 1-2-3 tasks, and those of the children they look after.
//
// URL: https://<project>.supabase.co/functions/v1/quex-mcp/<link token>
// (or send the token as "Authorization: Bearer qx_..."). Links are made and
// revoked under Account in Quex. Every rule lives in the database: this file
// only speaks MCP (Streamable HTTP, JSON responses) and calls the mcp_* RPCs.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `Quex is a co-op village game driven by real life. Each day a player has a "1-2-3" list of six tasks:
1 big task (slot 0: the one thing that matters most), 2 medium tasks (slots 1-2) and 3 small tasks (slots 3-5, quick wins).
Finishing tasks earns actions to spend on their village. The player ticks tasks off themselves in the app; you can't.
A player's day rolls over overnight at their own reset hour, so use the "today" date the tools give, not your own clock.
Saturday is the Sabbath, a day of rest: it has no tasks (only habits), so never plan tasks for a Saturday.
Some players are children whose tasks are set by a parent or guardian ("set_by_parent"): only the parent's account can change them.
Planning tips: keep each task short and concrete (under ~60 characters), one big task a day, small tasks really small, and leave
room for school, work and rest. Ask before overwriting tasks that are already written. Task names are private to the player and
their guardians; neighbours in the world never see them.`

const TOOLS = [
  {
    name: 'quex_people',
    title: 'Who can I plan for?',
    description: 'List the Quex players this link can see: the user themselves and any children they look after, with each player\'s current day and whether you may edit their tasks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'quex_get_tasks',
    title: 'Read tasks',
    description: 'Read a player\'s task list (names and done / half done / not done) for a range of days: past days, today, or days already planned ahead. Defaults to the user\'s own player and today.',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player name or id from quex_people. Omit for the user themselves.' },
        from: { type: 'string', format: 'date', description: 'First day, YYYY-MM-DD. Default: the player\'s today.' },
        to: { type: 'string', format: 'date', description: 'Last day, YYYY-MM-DD (at most 30 days after from). Default: same as from.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'quex_set_tasks',
    title: 'Plan tasks',
    description: 'Write task names for one or more days, from yesterday up to 14 days ahead, for the user or a child they look after. Saturdays are rest days with no tasks and are refused. Only the slots you give are changed; an empty string clears a slot. This never marks anything done.',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player name or id from quex_people. Omit for the user themselves.' },
        days: {
          type: 'array', minItems: 1, maxItems: 15,
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date', description: 'YYYY-MM-DD in the player\'s calendar.' },
              big: { type: 'string', description: 'The one big task.' },
              medium: { type: 'array', items: { type: 'string' }, maxItems: 2, description: 'Up to two medium tasks, in order.' },
              small: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Up to three small tasks, in order.' },
            },
            required: ['date'],
            additionalProperties: false,
          },
        },
      },
      required: ['days'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
]

type Json = Record<string, unknown>

async function rpc(fn: string, args: Json): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error((body && (body.message as string)) || `Quex error ${r.status}`)
  return body
}

interface DayPlan { date: string; big?: string; medium?: string[]; small?: string[] }

async function callTool(token: string, name: string, a: Json): Promise<unknown> {
  const player = typeof a.player === 'string' ? a.player : null
  switch (name) {
    case 'quex_people':
      return rpc('mcp_people', { p_token: token })
    case 'quex_get_tasks':
      return rpc('mcp_tasks', { p_token: token, p_player: player, p_from: a.from ?? null, p_to: a.to ?? null })
    case 'quex_set_tasks': {
      const days = Array.isArray(a.days) ? (a.days as DayPlan[]) : []
      if (!days.length) throw new Error('Give at least one day to plan')
      const saved = []
      for (const d of days) {
        // the Sabbath: no tasks on a Saturday
        if (/^\d{4}-\d{2}-\d{2}$/.test(d.date) && new Date(d.date + 'T00:00:00Z').getUTCDay() === 6) {
          throw new Error(`${d.date} is a Saturday, the Sabbath: a day of rest with no tasks. Plan the other days.`)
        }
        const tasks: { slot: number; task: string }[] = []
        if (typeof d.big === 'string') tasks.push({ slot: 0, task: d.big })
        ;(d.medium ?? []).slice(0, 2).forEach((t, i) => tasks.push({ slot: 1 + i, task: String(t) }))
        ;(d.small ?? []).slice(0, 3).forEach((t, i) => tasks.push({ slot: 3 + i, task: String(t) }))
        if ((d.medium?.length ?? 0) > 2 || (d.small?.length ?? 0) > 3) throw new Error('A day has 1 big, 2 medium and 3 small tasks')
        saved.push(await rpc('mcp_set_tasks', { p_token: token, p_player: player, p_date: d.date, p_tasks: tasks }))
      }
      return { saved }
    }
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

async function handle(token: string, msg: Json): Promise<Json | null> {
  const id = msg.id ?? null
  const method = String(msg.method ?? '')
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (msg.id === undefined) return null // a notification: nothing to say back

  switch (method) {
    case 'initialize': {
      const asked = (msg.params as Json | undefined)?.protocolVersion as string | undefined
      return ok({
        protocolVersion: asked && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'quex', title: 'Quex', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call': {
      const p = (msg.params ?? {}) as Json
      try {
        const out = await callTool(token, String(p.name), (p.arguments ?? {}) as Json)
        const structured = Array.isArray(out) ? { people: out } : (out as Json)
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: structured })
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    case 'resources/list': return ok({ resources: [] })
    case 'prompts/list': return ok({ prompts: [] })
    default:
      return fail(-32601, `Method not found: ${method}`)
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)
  const fromPath = url.pathname.split('/').filter(Boolean).find((s) => s.startsWith('qx_'))
  const auth = req.headers.get('authorization') ?? ''
  const token = fromPath ?? (auth.startsWith('Bearer qx_') ? auth.slice(7) : '')

  if (req.method === 'GET') {
    // no server-initiated stream; a browser visit gets a friendly note
    if ((req.headers.get('accept') ?? '').includes('text/event-stream')) return new Response(null, { status: 405, headers: CORS })
    return new Response('This is the Quex connector for AI assistants. Add this whole address as a custom connector in Claude or ChatGPT.\n',
      { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: CORS })
  if (!token) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing Quex link token: use the full address from Account in Quex' } }, 401)

  let body: unknown
  try { body = await req.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(token, m as Json)))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS })
  }
  const out = await handle(token, body as Json)
  return out ? json(out) : new Response(null, { status: 202, headers: CORS })
})
