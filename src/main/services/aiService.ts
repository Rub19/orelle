// Optional AI assistant, off by default. The user picks a provider (Anthropic Claude, OpenAI, or a
// local Ollama server), gives their own key, and must explicitly consent before anything is sent.
// Only the question typed after "?" in the launcher leaves the computer: no files, clipboard,
// window titles or history are attached. Keys are encrypted with Windows DPAPI (safeStorage).
import Anthropic from '@anthropic-ai/sdk';
import { safeStorage } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { SearchResult } from '../../shared/types';
import type { OrelleContext } from '../context';
import type { SearchPlugin } from './searchService';
import { log } from '../logger';

export const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', openai: '', ollama: '' } as const;
const MAX_QUESTION = 2000;

export type AiAnswer = { query: string; state: 'loading' } | { query: string; state: 'answer'; text: string; model: string } | { query: string; state: 'error'; text: string };

export class AiService extends EventEmitter implements SearchPlugin {
  readonly prefix = 'ai';
  private keyFile: string;
  private busy = false;

  constructor(private readonly ctx: OrelleContext) {
    super();
    this.keyFile = path.join(ctx.dataDir, 'ai-key.bin');
  }

  private get cfg() {
    return this.ctx.settings.get().ai;
  }

  hasKey() {
    return fs.existsSync(this.keyFile);
  }

  /** Stores the API key encrypted for the current Windows user; an empty key deletes it. */
  setKey(key: string): boolean {
    const k = key.trim();
    if (!k) {
      try { fs.unlinkSync(this.keyFile); } catch { /* none */ }
      return true;
    }
    if (!safeStorage.isEncryptionAvailable() || k.length > 400) return false;
    fs.writeFileSync(this.keyFile, safeStorage.encryptString(k));
    return true;
  }

  private key(): string | null {
    try {
      return safeStorage.decryptString(fs.readFileSync(this.keyFile));
    } catch {
      return null;
    }
  }

  private providerName() {
    return { none: '', anthropic: 'Claude', openai: 'OpenAI', ollama: 'Ollama' }[this.cfg.provider];
  }

  search(q: string): SearchResult[] {
    if (this.cfg.provider === 'none' || !q.startsWith('?')) return [];
    const question = q.slice(1).trim();
    if (!question) return [];
    return [{
      id: `ai:${question}`,
      kind: 'ai',
      title: this.ctx.t('ai.ask', { q: question }),
      subtitle: this.cfg.consent ? this.ctx.t('ai.via', { provider: this.providerName() }) : this.ctx.t('ai.needConsent'),
      glyph: 'sparkle',
      score: 5,
      action: this.ctx.t('ai.send'),
    }];
  }

  /** Never closes the launcher: the answer is pushed to it as an event. */
  async execute(question: string): Promise<boolean> {
    if (!this.cfg.consent) {
      this.ctx.actions.openSettings('ai');
      return true;
    }
    void this.ask(question);
    return false;
  }

  async ask(raw: string): Promise<AiAnswer> {
    const query = raw.slice(0, MAX_QUESTION);
    const done = (a: AiAnswer) => {
      this.emit('answer', a);
      return a;
    };
    if (this.cfg.provider === 'none' || !this.cfg.consent) return done({ query, state: 'error', text: this.ctx.t('ai.needConsent') });
    if (this.busy) return { query, state: 'loading' };
    this.busy = true;
    this.emit('answer', { query, state: 'loading' });
    try {
      const res = await this.call(query);
      return done({ query, state: 'answer', ...res });
    } catch (err) {
      log.warn('ai', `${this.cfg.provider} request failed`, err instanceof Error ? err.message : err);
      return done({ query, state: 'error', text: this.describeError(err) });
    } finally {
      this.busy = false;
    }
  }

  private system() {
    return this.ctx.language === 'fr'
      ? 'Tu es l’assistant intégré à Orelle, un lanceur pour Windows. Réponds en français, de façon concise et directe (quelques phrases ou une courte liste). Pas de préambule.'
      : 'You are the assistant built into Orelle, a Windows launcher. Answer concisely and directly (a few sentences or a short list). No preamble.';
  }

  private async call(question: string): Promise<{ text: string; model: string }> {
    const cfg = this.cfg;
    if (cfg.provider === 'anthropic') {
      const apiKey = this.key();
      if (!apiKey) throw new Error('no-key');
      const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
      const model = cfg.model || DEFAULT_MODELS.anthropic;
      // Server-side fallbacks: if the model declines, the API retries on its default fallback model.
      const msg = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: this.system(),
        messages: [{ role: 'user', content: question }],
      });
      if (msg.stop_reason === 'refusal') throw new Error('refusal');
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      return { text: text || '—', model: msg.model };
    }
    if (cfg.provider === 'openai') {
      const apiKey = this.key();
      if (!apiKey) throw new Error('no-key');
      if (!cfg.model) throw new Error('no-model');
      const base = (cfg.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: this.system() }, { role: 'user', content: question }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`http-${r.status}`);
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      return { text: j.choices?.[0]?.message?.content?.trim() || '—', model: cfg.model };
    }
    // Ollama: a model running on this computer (or the user's own server).
    if (!cfg.model) throw new Error('no-model');
    const base = (cfg.endpoint || 'http://localhost:11434').replace(/\/+$/, '');
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, stream: false, messages: [{ role: 'system', content: this.system() }, { role: 'user', content: question }] }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) throw new Error(`http-${r.status}`);
    const j = (await r.json()) as { message?: { content?: string } };
    return { text: j.message?.content?.trim() || '—', model: cfg.model };
  }

  private describeError(err: unknown): string {
    const t = this.ctx.t;
    if (err instanceof Anthropic.AuthenticationError) return t('ai.error.key');
    if (err instanceof Anthropic.RateLimitError) return t('ai.error.rate');
    if (err instanceof Anthropic.APIConnectionError) return t('ai.error.network');
    if (err instanceof Anthropic.APIError) return t('ai.error.api', { status: String(err.status ?? '?') });
    const m = err instanceof Error ? err.message : '';
    if (m === 'no-key') return t('ai.error.noKey');
    if (m === 'no-model') return t('ai.error.noModel');
    if (m === 'refusal') return t('ai.error.refusal');
    if (m === 'http-401' || m === 'http-403') return t('ai.error.key');
    if (m === 'http-429') return t('ai.error.rate');
    if (/^http-/.test(m)) return t('ai.error.api', { status: m.slice(5) });
    return t('ai.error.network');
  }
}
