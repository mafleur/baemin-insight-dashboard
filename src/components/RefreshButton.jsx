import { useState } from 'react';

// No VITE_GITHUB_TOKEN here — the token lives server-side in /api/trigger-refresh
export default function RefreshButton() {
    const [state, setState] = useState('idle'); // idle | triggering | waiting | done | error
    const [msg, setMsg] = useState('');

    const handleRefresh = async () => {
        if (state === 'triggering' || state === 'waiting') return;
        setState('triggering');
        setMsg('');

        try {
            const res = await fetch('/api/trigger-refresh', { method: 'POST' });
            const body = await res.json().catch(() => ({}));

            if (res.ok && body.ok) {
                setState('waiting');
                setMsg('뉴스 수집 중... (약 2~3분 소요)');
                setTimeout(() => {
                    setState('done');
                    setMsg('완료! 새로고침합니다...');
                    setTimeout(() => window.location.reload(), 1500);
                }, 120000);
            } else {
                throw new Error(body.error || `서버 오류 (${res.status})`);
            }
        } catch (err) {
            setState('error');
            setMsg(`실패: ${err.message}`);
        }
    };

    const base = 'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all';
    const cls = {
        idle: `${base} bg-white text-gray-600 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200`,
        triggering: `${base} bg-violet-50 text-violet-600 border-violet-200 cursor-wait`,
        waiting: `${base} bg-violet-50 text-violet-600 border-violet-200 cursor-wait`,
        done: `${base} bg-green-50 text-green-700 border-green-200`,
        error: `${base} bg-red-50 text-red-700 border-red-200`,
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <button onClick={handleRefresh} className={cls[state]} title="새 기사 가져오기">
                {state === 'triggering' || state === 'waiting' ? (
                    <>
                        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        수집 중...
                    </>
                ) : state === 'done' ? '✓ 완료' : (
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
