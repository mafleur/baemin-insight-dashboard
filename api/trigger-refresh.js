/**
 * api/trigger-refresh.js — Vercel serverless function
 *
 * Proxies GitHub Actions workflow_dispatch trigger.
 * GITHUB_TOKEN is a server-side env var (no VITE_ prefix) and never exposed to browsers.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.VITE_GITHUB_REPO;  // just the repo path, not sensitive

    if (!token || !repo) {
        return res.status(500).json({ error: 'Server misconfiguration: GITHUB_TOKEN or VITE_GITHUB_REPO not set' });
    }

    try {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/actions/workflows/daily-update.yml/dispatches`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                body: JSON.stringify({ ref: 'main' }),
            }
        );

        if (response.status === 204) {
            return res.status(200).json({ ok: true, message: '뉴스 수집 시작됨' });
        }

        const body = await response.json().catch(() => ({}));
        return res.status(response.status).json({ ok: false, error: body.message || `GitHub API error ${response.status}` });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
