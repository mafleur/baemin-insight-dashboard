import { useState, useEffect, useRef } from 'react';

export default function RefreshButton({ currentRunId, onRefreshDone }) {
    const [state, setState] = useState('idle'); // idle | triggering | polling | done | error | nonew
    const [msg, setMsg] = useState('');
    const pollInterval = useRef(null);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollInterval.current) clearInterval(pollInterval.current);
        };
    }, []);

    const pollData = () => {
        if (pollInterval.current) clearInterval(pollInterval.current);

        // Timeout after 3 minutes if no new runId
        const startTime = Date.now();

        pollInterval.current = setInterval(async () => {
            if (Date.now() - startTime > 180000) {
                clearInterval(pollInterval.current);
                setState('error');
                setMsg('시간 초과');
                return;
            }

            try {
                const res = await fetch(`/data.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                const fetchedRunId = data.metadata?.runId || '';

                if (fetchedRunId !== currentRunId && fetchedRunId !== '') {
                    // Script finished running!
                    clearInterval(pollInterval.current);
                    const newCount = data.metadata?.newArticlesCount || 0;

                    if (newCount === 0) {
                        setState('nonew');
                        setMsg('새 기사가 없습니다.');
                        setTimeout(() => { setState('idle'); setMsg(''); }, 4000);
                    } else {
                        setState('done');
                        setMsg(`${newCount}개 기사 업데이트 됨!`);
                        setTimeout(() => { setState('idle'); setMsg(''); }, 4000);
                    }
                    if (onRefreshDone) onRefreshDone(data);
                }
            } catch (err) {
                // Ignore fetch errors during polling
            }
        }, 5000); // Check every 5 seconds
    };

    const handleRefresh = async () => {
        if (state === 'triggering' || state === 'polling') return;
        setState('triggering');
        setMsg('');

        try {
            const res = await fetch('/api/trigger-refresh', { method: 'POST' });
            const body = await res.json().catch(() => ({}));

            if (res.ok && body.ok) {
                setState('polling');
                setMsg('새 소식 탐색 중...');
                pollData();
            } else {
                throw new Error(body.error || `서버 오류 (${res.status})`);
            }
        } catch (err) {
            setState('error');
            setMsg(`실패: ${err.message}`);
            setTimeout(() => { setState('idle'); setMsg(''); }, 4000);
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
                ) : state === 'done' ? '✓ 새로고침 완료' : state === 'nonew' ? '✓ 최신 상태입니다' : (
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
