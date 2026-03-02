import { useState } from 'react';

const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN;
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO;   // e.g. "ae-heesung/baemin-insight-dashboard"

export default function RefreshButton({ onRefreshComplete }) {
    const [state, setState] = useState('idle'); // idle | triggering | waiting | done | error
    const [msg, setMsg] = useState('');

    const handleRefresh = async () => {
        if (state === 'triggering' || state === 'waiting') return;

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            setMsg('VITE_GITHUB_TOKEN 또는 VITE_GITHUB_REPO 환경변수가 설정되지 않았습니다.');
            setState('error');
            return;
        }

        setState('triggering');
        setMsg('');

        try {
            const res = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/daily-update.yml/dispatches`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${GITHUB_TOKEN}`,
                        Accept: 'application/vnd.github+json',
                        'Content-Type': 'application/json',
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                    body: JSON.stringify({ ref: 'main' }),
                }
            );

            if (res.status === 204) {
                // Workflow triggered — now wait ~90s then reload data
                setState('waiting');
                setMsg('뉴스 수집 중... (약 2~3분 소요)');
                setTimeout(async () => {
                    setState('done');
                    setMsg('완료! 페이지를 새로고침합니다...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                }, 120000); // 2 minutes
            } else {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `HTTP ${res.status}`);
            }
        } catch (err) {
            setState('error');
            setMsg(`실패: ${err.message}`);
        }
    };

    const btnClass = () => {
        const base = 'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all';
        if (state === 'triggering' || state === 'waiting')
            return `${base} bg-violet-50 text-violet-600 border-violet-200 cursor-wait`;
        if (state === 'done')
            return `${base} bg-green-50 text-green-700 border-green-200`;
        if (state === 'error')
            return `${base} bg-red-50 text-red-700 border-red-200`;
        return `${base} bg-white text-gray-600 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200`;
    };

    const Spinner = () => (
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
    );

    return (
        <div className="flex flex-col items-end gap-1">
            <button onClick={handleRefresh} className={btnClass()} title="새 기사 가져오기">
                {(state === 'triggering' || state === 'waiting') ? (
                    <><Spinner /> 수집 중...</>
                ) : state === 'done' ? (
                    <>✓ 완료</>
                ) : (
                    <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        새로고침
                    </>
                )}
            </button>
            {msg && (
                <span className={`text-xs ${state === 'error' ? 'text-red-500' : state === 'done' ? 'text-green-600' : 'text-violet-500'}`}>
                    {msg}
                </span>
            )}
        </div>
    );
}
