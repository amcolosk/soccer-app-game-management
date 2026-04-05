import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ManagementQueryFixtures } from './fixtures/managementFixtures';
import {
  resetManagementHarness,
  setAmplifyQueryData,
  setConfirmResult,
  setSwipedItemId,
} from './mockAmplifyClient';

interface ManagementHarnessOptions {
  queryData?: Partial<ManagementQueryFixtures>;
  confirmResult?: boolean;
  swipedItemId?: string | null;
}

export function renderWithProviders(
  ui: ReactElement,
  options: ManagementHarnessOptions = {},
) {
  resetManagementHarness();
  setAmplifyQueryData(options.queryData ?? {});
  setConfirmResult(options.confirmResult ?? true);
  setSwipedItemId(options.swipedItemId ?? null);

  return render(<MemoryRouter>{ui}</MemoryRouter>);
}
