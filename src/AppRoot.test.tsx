import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSkipVerification = vi.fn();
let mockAuth: { authStatus: string; route: string };

vi.mock('@aws-amplify/ui-react', () => {
  const Authenticator = Object.assign(() => <div>authenticator-form</div>, {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  });
  return {
    Authenticator,
    useAuthenticator: () => ({ ...mockAuth, skipVerification: mockSkipVerification }),
  };
});
vi.mock('@aws-amplify/ui-react/styles.css', () => ({}));
vi.mock('./App', () => ({ default: () => <div>app-shell</div> }));
vi.mock('./components/LandingPage', () => ({ LandingPage: () => <div>landing-page</div> }));
vi.mock('./components/UpdatePrompt', () => ({ UpdatePrompt: () => null }));

import AppRoot from './AppRoot';

describe('AppRoot', () => {
  beforeEach(() => {
    mockSkipVerification.mockClear();
  });

  it('skips the Authenticator verifyUser step once authenticated so SIGN_OUT is not ignored', () => {
    mockAuth = { authStatus: 'authenticated', route: 'verifyUser' };
    render(<AppRoot />);

    expect(screen.getByText('app-shell')).toBeInTheDocument();
    expect(mockSkipVerification).toHaveBeenCalledTimes(1);
  });

  it('does not skip anything for a normally authenticated user', () => {
    mockAuth = { authStatus: 'authenticated', route: 'authenticated' };
    render(<AppRoot />);

    expect(mockSkipVerification).not.toHaveBeenCalled();
  });

  it('does not skip while signed out, even if the machine is on verifyUser', () => {
    mockAuth = { authStatus: 'unauthenticated', route: 'verifyUser' };
    render(<AppRoot />);

    expect(screen.getByText('landing-page')).toBeInTheDocument();
    expect(mockSkipVerification).not.toHaveBeenCalled();
  });
});
