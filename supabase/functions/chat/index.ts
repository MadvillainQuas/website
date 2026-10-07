// ============================================================================
// CHAT - one message to a game's live chat, checked and moderated before anybody sees it (0237).
//
//   POST { gameId, body, adult? }   with the fan's own session (Authorization: Bearer <their access token>)
//   -> { ok: true, message: {id, username, avatar_url, body, created_at} }
//   -> { ok: false, reason }   signed_out | banned | username | adult | closed | not_now | empty | long | words | link |
//                              slow | muted | day_full | blocked | moderation_off | moderation_failed
//
// 1. WHO: the session's user, from the token (the gateway has already checked it is one of ours).
// 2. MAY THEY: chat_gate (0237) - a username, 18 or over, a league with its chat on, a game that is on, the word list,
//    no links, the slow-down. A refusal there costs nothing and reaches no model.
// 3. THE MODERATOR reads it (_shared/chatmod.js: the policy, the message as data, fail-closed) - Claude, through the
//    Anthropic SDK, at low effort: a chat message is a short classification. The model is CHAT_MODERATION_MODEL when
//    set, claude-opus-5-5 otherwise. Without ANTHROPIC_API_KEY nothing is posted at all (moderation_off): an
//    unmoderated public chat is not an option this function offers.
// 4. KEPT: chat_store writes it as shown (and the database sends it on chat:<game> at once) or blocked (kept for the
//    record, shown to nobody). A moderator that does not answer in time posts nothing and stores nothing.
//
// Secrets: ANTHROPIC_API_KEY (and optionally CHAT_MODERATION_MODEL), set with `supabase secrets set`.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.131.0/helpers/zod';
import { z } from 'npm:zod@4.6.5';
import { SYSTEM, CATEGORIES, userContent, verdictOf } from '../_shared/chatmod.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } });
const KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = Deno.env.get('CHAT_MODERATION_MODEL') || 'claude-opus-5-5';
const claude = KEY ? new Anthropic({ apiKey: KEY, maxRetries: 1, timeout: 9000 }) : null;

const Verdict = z.object({
  allow: z.boolean(),
  category: z.enum(CATEGORIES as [string, ...string[]]),
  reason: z.string(),
});

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function moderate(body: string, ctx: Record<string, string>) {
  try {
    const res = await claude!.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent(body, ctx) }],
      output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
    });
    return verdictOf(res);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) console.error('chat: moderator rate limited');
    else if (e instanceof Anthropic.AuthenticationError) console.error('chat: ANTHROPIC_API_KEY is not accepted');
    else if (e instanceof Anthropic.APIError) console.error('chat: moderator error ' + e.status);
    else console.error('chat: moderator unreachable: ' + (e as Error).message);
    return { status: 'failed', category: null, reason: 'unreachable' };
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  let p: { gameId?: string; body?: string; adult?: boolean };
  try { p = await req.json(); } catch { return json({ ok: false, reason: 'empty' }, 400); }
  const gameId = String(p.gameId || '');
  const body = String(p.body || '').slice(0, 1000);
  if (!UUID.test(gameId)) return json({ ok: false, reason: 'closed' }, 400);

  // 1. who
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = token ? await admin.auth.getUser(token) : { data: null };
  const user = who && who.user;
  if (!user) return json({ ok: false, reason: 'signed_out' }, 401);

  // 2. may they
  const { data: gate, error: gerr } = await admin.rpc('chat_gate', { p_user: user.id, p_game: gameId, p_body: body, p_adult: !!p.adult });
  if (gerr || !gate) return json({ ok: false, reason: 'closed' }, gerr ? 500 : 400);
  if (!gate.ok) return json({ ok: false, reason: gate.reason }, gate.reason === 'slow' || gate.reason === 'muted' ? 429 : 400);

  // 3. the moderator
  if (!claude) return json({ ok: false, reason: 'moderation_off' }, 503);
  const v = await moderate(gate.body, { league: gate.league, home: gate.home, away: gate.away });
  if (v.status === 'failed') return json({ ok: false, reason: 'moderation_failed' }, 503);

  // 4. kept
  const { data: id, error: serr } = await admin.rpc('chat_store', {
    p_user: user.id, p_game: gameId, p_body: gate.body, p_username: gate.username, p_avatar: gate.avatar ?? null,
    p_status: v.status, p_category: v.category, p_reason: v.reason, p_model: MODEL,
  });
  if (serr) return json({ ok: false, reason: 'moderation_failed' }, 500);
  if (v.status !== 'shown') return json({ ok: false, reason: 'blocked', category: v.category, detail: v.reason });
  return json({ ok: true, message: { id, username: gate.username, avatar_url: gate.avatar ?? null, body: gate.body,
                                     created_at: new Date().toISOString() } });
});
