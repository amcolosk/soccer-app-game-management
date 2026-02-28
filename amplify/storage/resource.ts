import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'teamtrackStorage',
  access: (allow) => ({
    // Per-user prefix: each user can only write to their own identity segment.
    // Any authenticated user may read (acceptable per spec — DevDashboard is gated
    // by DEVELOPER_EMAILS and regular coaches have no UI path to other users' keys).
    'bug-screenshots/{entity_id}/*': [
      allow.entity('identity').to(['write']),   // owner-only write — prevents cross-user overwrite
      allow.authenticated.to(['read']),          // any authenticated user can read (spec-accepted)
      // Lambda S3 access granted via CDK in backend.ts to avoid circular stack dependency
      // (allow.resource() here would create storage→function→storage cycle)
    ],
  }),
});
