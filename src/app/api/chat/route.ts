import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { SYSTEM_PROMPT } from '@/lib/chat-config';
import { createServerSupabase } from '@/lib/supabase/server';
import { detectRecurring, estimateMonthlyTotal, isLikelySubscription } from '@/lib/recurring-detection';
import type { Transaction } from '@/lib/queries/types';
import { z } from 'zod';

export const maxDuration = 120;

// --- Abuse guardrails ---------------------------------------------------
// Per-instance in-memory rate limiting. Vercel may run multiple instances,
// so treat these as burst protection, not exact quotas; the hard backstop
// is the free-tier quota on the Gemini key itself.
const WINDOW_MS = 5 * 60_000;
const MAX_REQUESTS_PER_IP = 10; // per window
const MAX_REQUESTS_GLOBAL = 40; // per window, across all IPs on this instance
const MAX_HISTORY_MESSAGES = 12; // ~6 back-and-forth exchanges per conversation
const MAX_QUESTION_CHARS = 1000;

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

function rateLimited(ip: string): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS);
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_REQUESTS_PER_IP || globalHits.length >= MAX_REQUESTS_GLOBAL) {
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  globalHits.push(now);
  if (ipHits.size > 1000) ipHits.clear(); // bound memory
  return false;
}

function textLength(message: UIMessage): number {
  return message.parts.reduce(
    (n, p) => n + (p.type === 'text' ? p.text.length : 0),
    0
  );
}
// ------------------------------------------------------------------------

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) {
    return Response.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const trimmedHistory = messages.slice(-MAX_HISTORY_MESSAGES);
  const latest = trimmedHistory[trimmedHistory.length - 1];
  if (!latest || latest.role !== 'user' || textLength(latest) === 0) {
    return Response.json({ error: 'Empty message.' }, { status: 400 });
  }
  if (textLength(latest) > MAX_QUESTION_CHARS) {
    return Response.json(
      { error: 'Message too long. Please keep questions under 1000 characters.' },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = streamText({
    model: google('gemini-3.5-flash-lite'),
    system: `${SYSTEM_PROMPT}\n\nToday's date is ${today}.`,
    messages: await convertToModelMessages(trimmedHistory),
    maxOutputTokens: 1500,
    // Don't burn free-tier quota re-hitting a throttled API.
    maxRetries: 1,
    tools: {
      execute_query: {
        description: 'Execute a read-only SQL query against the Supabase PostgreSQL database to retrieve financial data. Only SELECT queries are allowed.',
        inputSchema: z.object({
          query: z.string().describe('The SQL SELECT query to execute'),
        }),
        execute: async ({ query }: { query: string }) => {
          // The DB-side check rejects queries with leading whitespace or
          // trailing semicolons, which models emit constantly — normalize here.
          const sql = query.trim().replace(/;+\s*$/, '');
          if (!sql.toUpperCase().startsWith('SELECT')) {
            return { error: 'Only SELECT queries are allowed' };
          }

          const supabase = createServerSupabase();
          const { data, error } = await supabase.rpc('execute_readonly_query', {
            query_text: sql,
          });

          if (error) {
            return { error: `Query failed: ${error.message}. Try rephrasing your query.` };
          }

          return { rows: data, count: Array.isArray(data) ? data.length : 0 };
        },
      },
      get_recurring_charges: {
        description: 'Get all detected recurring charges and subscriptions. Uses the same detection algorithm as the dashboard — groups transactions by merchant + amount and recognizes known subscription services. Use this whenever the user asks about subscriptions, recurring charges, bills, or monthly expenses.',
        inputSchema: z.preprocess(() => ({}), z.object({})),
        execute: async () => {
          const supabase = createServerSupabase();
          const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .order('date', { ascending: false });

          if (error) {
            return { error: `Failed to fetch transactions: ${error.message}` };
          }

          const allCharges = detectRecurring(data as Transaction[]);
          const charges = allCharges.filter(c =>
            c.transactions.some(t => isLikelySubscription(t))
          );
          const monthlyTotal = estimateMonthlyTotal(charges);

          return {
            charges: charges.map(c => ({
              merchant: c.merchantName,
              amount: c.amount,
              frequency: c.frequency,
              lastCharged: c.lastChargeDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2-$3-$1'),
              occurrences: c.chargeCount,
            })),
            count: charges.length,
            estimatedMonthlyTotal: Math.round(monthlyTotal * 100) / 100,
          };
        },
      },
    },
    // Enough steps for several queries plus retries on SQL errors.
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('Chat stream error:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (/quota|rate.?limit|429|resource.?exhausted/i.test(message)) {
        return 'The assistant is at capacity right now — please wait a minute and try again.';
      }
      return 'Something went wrong answering that. Please try again.';
    },
  });
}
