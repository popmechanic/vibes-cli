/**
 * Image generation handler — generates UI mockup images via OpenRouter.
 * Pure fetch, no runtime deps. Ported to TypeScript.
 */

import type { EventCallback } from '../claude-bridge.ts';
import type { ServerContext } from '../config.ts';

const UI_SYSTEM_PROMPT = `You are a UI/UX designer generating interface mockups. RULES:
- Generate ONLY a flat UI screenshot — a single screen of a web application interface
- NO devices, NO browser chrome, NO phones, NO laptops, NO monitors framing the UI
- NO 3D perspective, NO isometric views, NO angled screens
- The image must be a DIRECT screenshot as if captured from a browser at 1280x800
- Use a realistic, modern design language with proper visual hierarchy
- Include actual UI elements: navigation, cards, buttons, inputs, typography, icons, data
- Use a cohesive color palette with proper contrast ratios for readability
- Apply consistent spacing rhythm (8px grid), clear alignment, and whitespace
- Typography must have clear hierarchy: headings, subheadings, body text, labels
- Include realistic placeholder content (names, numbers, dates) — not lorem ipsum
- Shadows, borders, and rounded corners should be subtle and consistent
- The interface must look like a real, shippable product — not a wireframe or sketch
- Responsive-aware layout: sidebar+main, header+content, cards grid, or split-pane`;

export async function handleGenerateImage(
  ctx: ServerContext,
  onEvent: EventCallback,
  prompt: string,
  model: string | undefined,
): Promise<void> {
  if (!ctx.openRouterKey) {
    onEvent({ type: 'error', message: 'OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env to enable image generation.' });
    return;
  }

  const sanitized = String(prompt || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 500);
  if (!sanitized) {
    onEvent({ type: 'error', message: 'Image prompt is required' });
    return;
  }

  try {
    onEvent({ type: 'imggen_status', status: 'generating' });

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vibes.diy',
        'X-Title': 'Vibes Image Generator',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-pro-image-preview',
        messages: [
          { role: 'system', content: UI_SYSTEM_PROMPT },
          { role: 'user', content: `Generate a web application UI screenshot for: ${sanitized}` }
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ImageGen] Failed (${resp.status}): ${errText.slice(0, 200)}`);
      onEvent({ type: 'error', message: `Image generation failed (${resp.status})` });
      return;
    }

    const data = await resp.json() as any;
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;

    if (!imageUrl) {
      onEvent({ type: 'error', message: 'No image returned from API' });
      return;
    }

    onEvent({ type: 'imggen_result', imageUrl, prompt: sanitized });
    console.log(`[ImageGen] Generated UI mockup for "${sanitized.slice(0, 50)}..."`);
  } catch (err: any) {
    console.error('[ImageGen] Error:', err.message);
    onEvent({ type: 'error', message: `Image generation failed: ${err.message}` });
  }
}
