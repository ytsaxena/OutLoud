/**
 * OutLoud — Sarvam AI (Bulbul) text-to-speech proxy
 * The API key lives in the SARVAM_API_KEY env var and never reaches the browser.
 */

const ENDPOINT = 'https://api.sarvam.ai/text-to-speech';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const key = process.env.SARVAM_API_KEY;
    if (!key) throw new Error('SARVAM_API_KEY is not set');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body.text || '').slice(0, 1500);
    if (!text.trim()) return res.status(400).json({ error: 'no text' });

    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
      body: JSON.stringify({
        text,
        language_code: 'en-IN',
        model: 'bulbul:v2',
        speaker: 'anushka',
        pace: 0.95,
        enable_preprocessing: true
      })
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error('sarvam ' + r.status + ': ' + t.slice(0, 300));
    }
    const j = await r.json();
    const audio = (j.audios || [])[0];
    if (!audio) throw new Error('empty audio response');
    return res.status(200).json({ audio, codec: 'wav' });
  } catch (err) {
    console.error('[outloud-tts]', err.message);
    return res.status(502).json({ error: 'upstream', detail: err.message.slice(0, 200) });
  }
}
