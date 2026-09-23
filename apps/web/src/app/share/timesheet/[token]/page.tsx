'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { EodSheetDto } from '@timeblock/shared-types';
import { api, detectBrowserTimeZone } from '../../../../api';
import { CupkeyLogo } from '../../../../components/CupkeyLogo';
import { TimesheetSheetView } from '../../../../components/TimesheetSheetView';

type SharedPayload = {
  employee: { name: string; email: string };
  sheetNo: string;
  sheet: EodSheetDto;
  expiresAt: string;
};

export default function SharedTimesheetPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const tz = detectBrowserTimeZone();

  const q = useQuery({
    queryKey: ['shared-timesheet', token],
    queryFn: () =>
      api.get<SharedPayload>(
        `/api/public/timesheet/${encodeURIComponent(token)}`,
      ),
    enabled: Boolean(token),
    retry: 1,
  });

  return (
    <div className="timesheet-page timesheet-share-public">
      <header className="timesheet-share-public-top no-print">
        <CupkeyLogo size={28} title="Cupkey" />
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Shared timesheet
          </h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            View-only link from Cupkey
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-pill no-print"
          onClick={() => window.print()}
          disabled={!q.data}
        >
          Print / PDF
        </button>
      </header>

      {q.isLoading && <p className="composer-hint">Loading shared timesheet…</p>}
      {q.isError && (
        <div className="card" style={{ padding: 20 }}>
          <strong>Link unavailable</strong>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {q.error instanceof Error
              ? q.error.message
              : 'This share link is invalid or has expired.'}
          </p>
        </div>
      )}
      {q.data && (
        <>
          <TimesheetSheetView
            employeeName={q.data.employee.name}
            employeeEmail={q.data.employee.email}
            sheetNo={q.data.sheetNo}
            date={q.data.sheet.date}
            sheet={q.data.sheet}
            timeZone={tz}
            footnoteExtra={`Shared link expires ${new Date(q.data.expiresAt).toLocaleDateString()}.`}
          />
        </>
      )}
    </div>
  );
}
