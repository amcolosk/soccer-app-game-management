import { useState, useCallback } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { useAmplifyQuery } from "./useAmplifyQuery";

const client = generateClient<Schema>();

export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'FIXED' | 'DEPLOYED' | 'CLOSED';
export type Issue = Schema['Issue']['type'];

interface UseBugReportsOptions {
  filterStatus?: IssueStatus;
}

interface UseBugReportsReturn {
  issues: Issue[];
  isSynced: boolean;
  updating: boolean;
  updateError: string | null;
  updateStatus: (issueNumber: number, status: IssueStatus, resolution?: string) => Promise<void>;
}

function sortByIssueNumberDesc(a: Issue, b: Issue): number {
  return (b.issueNumber ?? 0) - (a.issueNumber ?? 0);
}

export function useBugReports(options?: UseBugReportsOptions): UseBugReportsReturn {
  const filter = options?.filterStatus
    ? { status: { eq: options.filterStatus } }
    : undefined;

  const [refreshKey, setRefreshKey] = useState(0);

  const { data: issues, isSynced } = useAmplifyQuery(
    'Issue',
    { filter, sort: sortByIssueNumberDesc },
    [options?.filterStatus, refreshKey],
  );

  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const updateStatus = useCallback(async (
    issueNumber: number,
    status: IssueStatus,
    resolution?: string,
  ) => {
    setUpdating(true);
    setUpdateError(null);
    try {
      const { errors } = await client.mutations.updateIssueStatus({
        issueNumber,
        status,
        resolution,
      });
      if (errors?.length) {
        throw new Error(errors[0].message);
      }
      // Force re-fetch: observeQuery doesn't pick up changes from custom Lambda mutations
      // because they bypass the standard AppSync subscription pipeline.
      setRefreshKey(k => k + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update issue status';
      setUpdateError(message);
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  return { issues, isSynced, updating, updateError, updateStatus };
}
