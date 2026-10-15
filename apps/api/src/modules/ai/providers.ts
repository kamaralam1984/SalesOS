import { SCHEMA_HINT, type Feature } from './schemas';

export class AiProviderError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface AiRequest { feature: Feature; system: string; user: string; maxTokens: number; signal?: AbortSignal }
export interface AiResponse { text: string; inputTokens: number; outputTokens: number; model: string }
export interface AiProvider { readonly name: string; complete(req: AiRequest, model: string): Promise<AiResponse> }

/** Rough list prices (USD per 1M tokens) used ONLY for the cost estimate column; unknown models log cost 0. */
const PRICES: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6], 'gpt-4.1-mini': [0.4, 1.6], 'gemini-2.0-flash': [0.1, 0.4], 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [3, 15],
};
export function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const p = PRICES[model];
  return p ? (inTok * p[0] + outTok * p[1]) / 1_000_000 : 0;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 25_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new AiProviderError(`HTTP_${res.status}`, `provider returned ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof AiProviderError) throw e;
    throw new AiProviderError((e as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', 'provider request failed');
  } finally {
    clearTimeout(t);
  }
}

const key = (name: string) => {
  const v = process.env[name];
  if (!v) throw new AiProviderError('NO_API_KEY', `${name} is not configured on the server`);
  return v;
};

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  async complete(req: AiRequest, model: string): Promise<AiResponse> {
    const r = (await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key('OPENAI_API_KEY')}` }, {
      model, max_tokens: req.maxTokens, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    })) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: r.choices?.[0]?.message?.content ?? '', inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0, model };
  }
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  async complete(req: AiRequest, model: string): Promise<AiResponse> {
    const r = (await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key('GEMINI_API_KEY') }, {
      systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: req.maxTokens, temperature: 0.2 },
    })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    return { text: r.candidates?.[0]?.content?.parts?.[0]?.text ?? '', inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0, model };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  async complete(req: AiRequest, model: string): Promise<AiResponse> {
    const r = (await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, {
      model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }],
    })) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    return { text: r.content?.find((c) => c.type === 'text')?.text ?? '', inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0, model };
  }
}

/**
 * Deterministic local provider (tests, demos, no external call). It performs simple keyword/sentence extraction on the
 * NOTES block ONLY and never invents content. Test hooks: a NOTES body containing "[[fake:fail]]" throws, "[[fake:garbage]]"
 * returns non-JSON, "[[fake:schema]]" returns JSON that violates the schema.
 */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  async complete(req: AiRequest, model: string): Promise<AiResponse> {
    const notes = /<<<NOTES\n([\s\S]*?)\nNOTES>>>/.exec(req.user)?.[1] ?? '';
    if (notes.includes('[[fake:fail]]')) throw new AiProviderError('FAKE_FAILURE', 'forced failure');
    let text: string;
    if (notes.includes('[[fake:garbage]]')) text = 'not json at all';
    else if (notes.includes('[[fake:schema]]')) text = JSON.stringify({ summary: 'x', approveRefund: true });
    else text = JSON.stringify(build(req.feature, notes));
    return { text, inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(text.length / 4), model };
  }
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3 && !s.startsWith('[removed'));
const has = (s: string, words: string[]) => words.some((w) => s.toLowerCase().includes(w));

function build(feature: Feature, notes: string): unknown {
  const ss = sentences(notes);
  switch (feature) {
    case 'summarize':
      return { summary: ss.slice(0, 3).join(' ').slice(0, 1100), keyPoints: ss.slice(0, 5).map((x) => x.slice(0, 280)) };
    case 'extract': {
      const budget = ss.find((s) => has(s, ['budget', 'afford', 'price', 'fee', 'cost', 'rs.', 'inr', '₹', 'lakh']));
      const low = ss.some((s) => has(s, ['not interested', 'no interest', 'later', 'maybe']));
      const high = ss.some((s) => has(s, ['interested', 'wants to join', 'ready to', 'enrol', 'sign up']));
      return {
        requirements: ss.filter((s) => has(s, ['need', 'want', 'looking for', 'requirement', 'wants'])).slice(0, 6),
        objections: ss.filter((s) => has(s, ['expensive', 'too costly', 'concern', 'worried', 'not sure', 'objection', 'think about', 'competitor'])).slice(0, 6),
        interest: high && !low ? 'HIGH' : low && !high ? 'LOW' : high || low ? 'MEDIUM' : 'UNKNOWN',
        budget: { mentioned: !!budget, text: budget ? budget.slice(0, 190) : null },
        nextSteps: ss.filter((s) => has(s, ['call back', 'follow up', 'follow-up', 'send', 'schedule', 'demo', 'tomorrow', 'next week'])).slice(0, 5),
      };
    }
    case 'draft_followup': {
      const points = ss.slice(0, 2).join(' ');
      return {
        subject: 'Following up on our conversation',
        message: `Hello [NAME], thank you for your time. ${points ? `As we discussed: ${points.slice(0, 600)} ` : ''}Please let me know a convenient time to continue. (Draft - review before sending.)`,
        reminders: ['Check the facts above against the CRM before sending'],
      };
    }
    case 'call_brief':
      return {
        headline: ss[0] ? ss[0].slice(0, 280) : 'No notes available',
        history: ss.slice(0, 8).map((x) => x.slice(0, 280)),
        openItems: ss.filter((s) => has(s, ['pending', 'follow', 'send', 'call back', 'due'])).slice(0, 5),
        talkingPoints: ss.filter((s) => has(s, ['interested', 'need', 'concern', 'budget'])).slice(0, 5),
      };
  }
}

export function promptFor(feature: Feature, notesBlock: string, extra?: string): string {
  const task: Record<Feature, string> = {
    summarize: 'Summarise the NOTES for the sales rep.',
    extract: 'Extract requirements, objections, interest level, budget mentions and next steps stated in the NOTES.',
    draft_followup: 'Draft a polite follow-up message for the rep to review. Use only facts in the NOTES. Do not promise prices, discounts or outcomes.',
    call_brief: 'Prepare a short call brief from the NOTES (history, open items, talking points).',
  };
  return `${task[feature]}${extra ? `\nContext: ${extra}` : ''}\nReturn JSON exactly matching: ${SCHEMA_HINT[feature]}\n${notesBlock}`;
}
