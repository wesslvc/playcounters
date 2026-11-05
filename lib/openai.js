/**
 * One structured call to the Responses API. With `tier` 'flex' it goes on
 * OpenAI's Flex tier (Batch prices, slower answers); when Flex is out of
 * capacity it waits and tries again, the last try on the standard tier, and
 * when the model isn't offered on Flex it goes straight to standard.
 * `tools` passes through (web search, say).
 */
export async function ask(model, instructions, input, schema, signal, effort = 'low', tier = null, tools = null) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        reasoning: { effort },
        instructions,
        input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'answer', strict: true, schema } },
        ...(tools ? { tools } : {}),
        ...(tier ? { service_tier: tier } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      if (res.status === 400 && tier === 'flex' && /service[_ ]tier|flex/i.test(body)) { tier = null; continue; }
      if (res.status === 429 && tier === 'flex' && !/credits|insufficient_quota|billing/i.test(body) && attempt < 2) {
        if (attempt === 1) tier = null;
        await wait(3000 * (attempt + 1));
        continue;
      }
      throw new Error(`openai ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const raw = json.output_text
      ?? (json.output ?? []).flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
    const out = JSON.parse(raw);
    // what the call cost, in tokens, and the tier it actually ran on — kept off the answer itself
    Object.defineProperty(out, 'usage', { value: json.usage ? { ...json.usage, tier: json.service_tier ?? null } : null });
    return out;
  }
}
