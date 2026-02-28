import { defineStorage } from '@aws-amplify/backend';
import { sendBugReport } from '../functions/send-bug-report/resource';
import { updateIssueStatus } from '../functions/update-issue-status/resource';

export const storage = defineStorage({
  name: 'teamtrackStorage',
  access: (allow) => ({
    // Per-user prefix: each user can only write to their own identity segment.
    // Any authenticated user may read (acceptable per spec — DevDashboard is gated
    // by DEVELOPER_EMAILS and regular coaches have no UI path to other users' keys).
    'bug-screenshots/{entity_id}/*': [
      allow.entity('identity').to(['write']),   // owner-only write — prevents cross-user overwrite
      allow.authenticated.to(['read']),          // any authenticated user can read (spec-accepted)
      allow.resource(sendBugReport).to(['read']), // Lambda: generate presigned URL for email
      allow.resource(updateIssueStatus).to(['delete']), // Lambda: delete on CLOSED
    ],
  }),
});
