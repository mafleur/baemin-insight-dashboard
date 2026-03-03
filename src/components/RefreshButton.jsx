import { useState, useEffect, useRef } from 'react';

// VITE_GITHUB_DISPATCH_TOKEN: a GitHub fine-grained PAT with ONLY actions:write scope
// This limited scope cannot access any code or secrets — only trigger workflow runs
const DISPATCH_TOKEN = import.meta.env.VITE_GITHUB_DISPATCH_TOKEN;
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO;

export default function RefreshButton({ currentRunId, onRefreshDone }) {
    const [state, setState] = useState('idle'); // idle | triggering | polling | done | nonew | error
    const [msg, setMsg] = useState('');
    const pollRef = useRef(null);

    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const startPolling = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        const startTime = Date.now();

        pollRef.current = setInterval(async () => {
            if (Date.now() - startTime > 180000) {
                clearInterval(pollRef.current);
                setState('error');
                setMsg('시간 초과 (3분)');
                setTimeout(() => { setState('idle'); setMsg(''); }, 5000);
                return;
            }
            try {
                const res = await fetch(`/data.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                const rid = data.metadata?.runId || '';
                if (rid !== currentRunId && rid !== '') {
                    clearInterval(pollRef.current);
                    const n = data.metadata?.newArticlesCount || 0;
                    if (n === 0) {
                        setState('nonew');
                        setMsg('새 기사가 없습니다.');
                    } else {
                        setState('done');
                        setMsg(`${n}개 기사 업데이트 됨!`);
                    }
                    setTimeout(() => { setState('idle'); setMsg(''); }, 5000);
                    if (onRefreshDone) onRefreshDone(data);
                }
            } catch { /* ignore network errors during polling */ }
        }, 5000);
    };

    const handleRefresh = async () => {
        if (state === 'triggering' || state === 'polling') return;
        setState('triggering');
        setMsg('');

        if (!DISPATCH_TOKEN || !GITHUB_REPO) {
            setState('error');
            setMsg('환경변수 미설정');
            setTimeout(() => { setState('idle'); setMsg(''); }, 4000);
            return;
        }

        try {
            const res = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/daily-update.yml/dispatches`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${DISPATCH_TOKEN}`,
                        Accept: 'application/vnd.github+json',
                        'Content-Type': 'application/json',
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                    body: JSON.stringify({ ref: 'main' }),
                }
            );

            if (res.status === 204) {
                setState('polling');
                setMsg('새 소식 탐색 중...');
                startPolling();
            } else {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `GitHub 오류 (${res.status})`);
            }
        } catch (err) {
            setState('error');
            setMsg(`실패: ${err.message}`);
            setTimeout(() => { setState('idle'); setMsg(''); }, 5000);
        }
    };

    const base = 'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all';
    const cls = {
        idle: `${base} bg-white text-gray-600 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200`,
        triggering: `${base} bg-violet-50 text-violet-600 border-violet-200 cursor-wait`,
        polling: `${base} bg-violet-50 text-violet-600 border-violet-200 cursor-wait`,
        done: `${base} bg-green-50 text-green-700 border-green-200`,
        nonew: `${base} bg-gray-50 text-gray-500 border-gray-200`,
        error: `${base} bg-red-50 text-red-700 border-red-200`,
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <button onClick={handleRefresh} className={cls[state]} title="새 기사 가져오기">
                {state === 'triggering' || state === 'polling' ? (
                    <>
                        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        탐색 중...
                    </>
                ) : state === 'done' ? '✓ 새로고침 완료'
                    : state === 'nonew' ? '✓ 최신 상태입니다' : (
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
