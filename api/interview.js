/**
 * OutLoud — Gemini proxy (Vercel serverless function)
 * The API key lives in the GEMINI_API_KEY env var and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const COACH_RULES = `
You are Priya, a warm Indian HR manager running a short practice interview for
someone who reads and writes English well but is scared to SPEAK it.

Absolute rules:
- Never mention accent, mother tongue, or pronunciation. Ever.
- Judge ideas, structure and clarity. Do not nitpick grammar.
- The transcript comes from imperfect phone speech recognition. If a word looks
  garbled, assume the person said it correctly and ignore it.
- Every piece of feedback names something they did well before anything to fix.
- Give exactly ONE thing to improve. Not a list.
- Simple English, short sentences. No jargon, no idioms, no exam vocabulary.
- Never score below 40. This person is one bad comment away from quitting.
`;

function buildQuestionsPrompt(goal, level, session) {
  const goals = {
    job: 'a job interview (HR round and hiring manager round)',
    work: 'speaking at work with customers, supervisors and teammates',
    confidence: 'everyday confidence in speaking English'
  };
  const levels = {
    freeze: 'They freeze up completely. Start very easy and personal.',
    stumble: 'They can speak but stumble and pause. Medium difficulty.',
    polish: 'They are competent and want polish. Push them a little.'
  };
  return `${COACH_RULES}

Write exactly 3 spoken interview questions for practice session number ${session}.
Context: the learner wants to get better at ${goals[goal] || goals.job}.
Level: ${levels[level] || levels.stumble}
Session ${session} should be slightly harder than session ${session - 1}.

Rules for the questions:
- Question 1 must be easy and personal, so they get an early win.
- Question 2 asks for a real example or a story.
- Question 3 asks for an opinion or a judgement.
- Each question is ONE sentence, under 20 words, written to be spoken out loud.
- No question may require knowledge of a specific company or industry.

Return ONLY JSON: {"questions":["...","...","..."]}`;
}

function buildEvalPrompt(goal, level, answers) {
  const body = answers.map((a, i) =>
    `Q${i + 1}: ${a.q}\nAnswer (${a.secs}s): ${a.a || '(no answer given)'}`).join('\n\n');
  return `${COACH_RULES}

Here is the full practice interview transcript.

${body}

Score each dimension 40-100:
- fluency: did the words keep coming, or did they stall?
- clarity: was the point easy to follow?
- structure: was there a beginning, a middle and an end?
- vocabulary: did they use words that fit the situation?

Then write the feedback.

Return ONLY JSON in exactly this shape:
{
 "scores":{"fluency":0,"clarity":0,"structure":0,"vocabulary":0},
 "headline":"one warm sentence, max 16 words, about how they did overall",
 "wins":["specific thing they did well, quoting their own words","second one","third one"],
 "fix":"the single most useful thing to improve, 1-2 sentences, phrased as an action",
 "saidIt":"one real sentence copied from their answers that could be stronger",
 "betterIt":"the same idea rewritten in stronger, simple spoken English, max 35 words"
}`;
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  // Studio API keys start with "AIza" and go in a header.
  // OAuth access tokens (AQ..., ya29...) must go in an Authorization: Bearer header.
  const headers = { 'Content-Type': 'application/json' };
  if (/^AIza/.test(key)) headers['x-goog-api-key'] = key;
  else headers['Authorization'] = 'Bearer ' + key;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json'
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error('gemini ' + res.status + ': ' + t.slice(0, 300));
  }
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('empty response');
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { type, goal = 'job', level = 'stumble' } = body;

    if (type === 'questions') {
      const session = Math.max(1, Math.min(52, Number(body.session) || 1));
      const out = await callGemini(buildQuestionsPrompt(goal, level, session));
      const qs = (out.questions || []).filter(q => typeof q === 'string' && q.length > 8).slice(0, 3);
      if (qs.length < 3) throw new Error('not enough questions');
      return res.status(200).json({ questions: qs });
    }

    if (type === 'evaluate') {
      const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, 5).map(a => ({
        q: String(a.q || '').slice(0, 400),
        a: String(a.a || '').slice(0, 4000),
        secs: Number(a.secs) || 0
      }));
      if (!answers.length) return res.status(400).json({ error: 'no answers' });
      const out = await callGemini(buildEvalPrompt(goal, level, answers));
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: 'unknown type' });
  } catch (err) {
    console.error('[outloud]', err.message);
    // The client has a full offline fallback, so a 502 degrades gracefully.
    return res.status(502).json({ error: 'upstream', detail: err.message.slice(0, 200) });
  }
}
