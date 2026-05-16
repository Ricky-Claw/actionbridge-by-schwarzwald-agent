'use client';

import { useEffect, useState } from 'react';

type ErrorLogView = {
  id: string;
  connectorId: string | null;
  executionId: string | null;
  approvalId: string | null;
  category: string;
  severity: string;
  errorCode: string;
  message: string;
  redactedContext: Record<string, unknown>;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

type RetentionView = {
  dryRun: boolean;
  deletedCount: number;
  candidates: Record<string, number>;
  cutoffs: Record<string, string>;
};

const statusTone: Record<string, string> = {
  open: 'border-red-300/30 bg-red-500/10 text-red-100',
  acknowledged: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
  resolved: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100',
};

export default function ActionBridgeErrorOpsClient() {
  const [errorLogs, setErrorLogs] = useState<ErrorLogView[]>([]);
  const [retention, setRetention] = useState<RetentionView | null>(null);
  const [status, setStatus] = useState('Loading redacted operator error logs…');
  const [busy, setBusy] = useState(false);

  async function loadErrors() {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/errors?limit=25', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_ERROR_LOG_LIST_FAILED');
        setErrorLogs([]);
        return;
      }
      setErrorLogs(Array.isArray(body.errorLogs) ? body.errorLogs : []);
      setStatus('Loaded owner-scoped, redacted error logs.');
    } catch {
      setStatus('Could not load error logs from /api/actionbridge/errors.');
    } finally {
      setBusy(false);
    }
  }

  async function runRetention(destructive = false) {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/errors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(destructive
          ? { dryRun: false, confirm: 'DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS' }
          : { dryRun: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_ERROR_RETENTION_FAILED');
        return;
      }
      setRetention(body.retention || null);
      setStatus(destructive ? 'Expired resolved logs deleted and audited.' : 'Retention dry-run completed.');
      if (destructive) await loadErrors();
    } catch {
      setStatus('Retention operation failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(errorId: string, nextStatus: 'acknowledged' | 'resolved') {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errorId, status: nextStatus }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_ERROR_STATUS_UPDATE_FAILED');
        return;
      }
      setErrorLogs((current) => current.map((entry) => entry.id === errorId ? body.errorLog : entry));
      setStatus(`Error log marked ${nextStatus}.`);
    } catch {
      setStatus('Error status update failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadErrors(); }, []);

  return (
    <section className="mt-8 rounded-3xl border border-cyan-300/20 bg-cyan-400/10 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">Operator Error Ops</p>
          <h2 className="mt-2 text-2xl font-black text-white">Live redacted error monitor</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">
            Consumes <code>/api/actionbridge/errors</code>, supports forward-only status updates, and runs the resolved-log retention dry-run/delete operation with explicit confirmation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={loadErrors} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">Refresh</button>
          <button disabled={busy} onClick={() => runRetention(false)} className="rounded-xl bg-cyan-200 px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">Retention dry-run</button>
          <button disabled={busy} onClick={() => runRetention(true)} className="rounded-xl bg-red-300 px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">Delete expired resolved</button>
        </div>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-stone-200">{status}</p>

      {retention && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="font-bold text-cyan-100">Retention summary</h3>
          <pre className="mt-3 overflow-auto text-xs text-stone-300">{JSON.stringify(retention, null, 2)}</pre>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {errorLogs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">No error logs loaded, or none exist for this operator.</div>
        ) : errorLogs.map((entry) => (
          <article key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.12em]">
                  <span className={`rounded-full border px-2 py-1 ${statusTone[entry.status] || 'border-white/20 text-stone-200'}`}>{entry.status}</span>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-stone-300">{entry.severity}</span>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-stone-300">{entry.category}</span>
                </div>
                <h3 className="mt-3 font-bold text-white">{entry.errorCode}</h3>
                <p className="mt-1 text-sm text-stone-300">{entry.message}</p>
                <p className="mt-2 text-xs text-stone-500">Created: {entry.createdAt}</p>
              </div>
              <div className="flex gap-2">
                {entry.status === 'open' && <button disabled={busy} onClick={() => updateStatus(entry.id, 'acknowledged')} className="rounded-xl border border-amber-200/30 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-60">Acknowledge</button>}
                {entry.status !== 'resolved' && <button disabled={busy} onClick={() => updateStatus(entry.id, 'resolved')} className="rounded-xl border border-emerald-200/30 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-60">Resolve</button>}
              </div>
            </div>
            <details className="mt-3 text-xs text-stone-400">
              <summary className="cursor-pointer text-stone-300">Show redacted context</summary>
              <pre className="mt-2 overflow-auto rounded-xl bg-black/30 p-3">{JSON.stringify(entry.redactedContext || {}, null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
