import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormationVisualEditor } from './FormationVisualEditor';
import { getFvePitchWidthStyle } from './formationVisualEditorLayout';

const listMock = vi.hoisted(() => vi.fn());
const formationGetMock = vi.hoisted(() => vi.fn());
const formationUpdateMock = vi.hoisted(() => vi.fn());
const positionUpdateMock = vi.hoisted(() => vi.fn());
const setHelpContextMock = vi.hoisted(() => vi.fn());
const buildLineupShapeNodesMock = vi.hoisted(() => vi.fn());
const setFormationLayoutOverrideMock = vi.hoisted(() => vi.fn());
const getFormationLayoutOverrideMock = vi.hoisted(() => vi.fn());
const clearFormationLayoutOverrideMock = vi.hoisted(() => vi.fn());
const MAX_OVERRIDE_AGE_MS_MOCK = vi.hoisted(() => 5 * 60 * 1000);

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      FormationPosition: {
        list: listMock,
        update: positionUpdateMock,
      },
      Formation: {
        get: formationGetMock,
        update: formationUpdateMock,
      },
    },
  })),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: setHelpContextMock,
    helpContext: null,
    setDebugContext: vi.fn(),
    debugContext: null,
  }),
}));

vi.mock('./GameManagement/shape/lineupShapeDeterminism', () => ({
  buildLineupShapeNodes: buildLineupShapeNodesMock,
}));

vi.mock('../utils/formationLayoutOverride', () => ({
  MAX_OVERRIDE_AGE_MS: MAX_OVERRIDE_AGE_MS_MOCK,
  clearFormationLayoutOverride: clearFormationLayoutOverrideMock,
  getFormationLayoutOverride: getFormationLayoutOverrideMock,
  setFormationLayoutOverride: setFormationLayoutOverrideMock,
}));

describe('FormationVisualEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: null,
          yPct: null,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
        },
      ],
    });
    formationGetMock.mockResolvedValue({ data: { id: 'formation-1', layoutVersion: 1 } });
    formationUpdateMock.mockResolvedValue({ data: { id: 'formation-1', layoutVersion: 2 } });
    positionUpdateMock.mockResolvedValue({ data: { id: 'p1' } });
    getFormationLayoutOverrideMock.mockReturnValue(null);
    buildLineupShapeNodesMock.mockReturnValue([
      { positionId: 'p1', xPct: 33, yPct: 77, abbreviation: 'GK', displayName: 'Goalkeeper' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderEditor() {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const rendered = render(
      <FormationVisualEditor
        formationId="formation-1"
        formationName="4-4-2"
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    return { onClose, onSaved, ...rendered };
  }

  it('loads positions and renders nodes with inferred fallback coordinates', async () => {
    const { unmount } = renderEditor();

    expect(screen.getByRole('status', { name: /loading formation positions/i })).toBeInTheDocument();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toBeInTheDocument();
    expect(node).toHaveStyle('left: 33%; top: 77%;');
    const pitch = document.querySelector('.fve-pitch');
    expect(pitch).toBeInTheDocument();
    expect(pitch).toHaveClass('soccer-pitch-surface');
    expect(buildLineupShapeNodesMock).toHaveBeenCalled();

    unmount();
    expect(setHelpContextMock).toHaveBeenCalledWith('formation-visual-editor');
    expect(setHelpContextMock).toHaveBeenCalledWith('manage-formations');
  });

  it('keeps drag measurement on the forwarded shared pitch root', async () => {
    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    const pitch = document.querySelector('.fve-pitch') as HTMLDivElement;
    expect(pitch).toBeInTheDocument();
    expect(pitch).toHaveStyle('touch-action: none;');

    const rect: DOMRect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 300,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    };
    vi.spyOn(pitch, 'getBoundingClientRect').mockReturnValue(rect);

    Object.defineProperty(node, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(node, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    });

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 90, clientY: 180 });
    fireEvent.pointerMove(node, { pointerId: 1, clientX: 150, clientY: 180 });
    fireEvent.pointerUp(node, { pointerId: 1, clientX: 150, clientY: 180 });

    expect(node).toHaveStyle('left: 50%; top: 60%;');
  });

  it('applies guarded short-height clamp sizing and token-based pitch overrides', async () => {
    renderEditor();

    await screen.findByRole('button', { name: /goalkeeper/i });
    const pitch = document.querySelector('.fve-pitch') as HTMLDivElement;
    expect(pitch).toBeInTheDocument();

    const widthStyle = getFvePitchWidthStyle();
    expect(widthStyle).toContain('clamp(');
    expect(widthStyle).toContain('max(');
    expect(pitch.style.getPropertyValue('--soccer-pitch-background')).toBe('var(--fve-pitch-background)');
    expect(pitch.style.getPropertyValue('--soccer-pitch-border-color')).toBe('var(--fve-pitch-border-color)');
    expect(pitch.style.getPropertyValue('--soccer-pitch-line-color')).toBe('var(--fve-pitch-line-color)');
    expect(pitch.style.getPropertyValue('--soccer-pitch-spot-color')).toBe('var(--fve-pitch-spot-color)');
  });

  it('shows discard prompt when canceling with unsaved changes', async () => {
    const user = userEvent.setup();
    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.getByRole('dialog', { name: /discard unsaved changes/i })).toBeInTheDocument();
  });

  it('reset clears dirty state and reverts coordinates to last saved values', async () => {
    const user = userEvent.setup();
    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(node).toHaveStyle('left: 35%; top: 77%;');

    await user.click(screen.getByRole('button', { name: /^reset$/i }));

    await waitFor(() => {
      expect(node).toHaveStyle('left: 33%; top: 77%;');
    });
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeDisabled();
  });

  it('blocks save on layout version conflict and shows warning', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    formationGetMock.mockResolvedValueOnce({ data: { id: 'formation-1', layoutVersion: 2 } });
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/another coach saved this layout/i)).toBeInTheDocument();
    expect(positionUpdateMock).not.toHaveBeenCalled();
    expect(formationUpdateMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses limit:1000 to avoid DynamoDB scan-limit silently dropping positions', async () => {
    renderEditor();
    await screen.findByRole('button', { name: /goalkeeper/i });
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('always reloads latest formation positions when opening', async () => {
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: 50,
          yPct: 86,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
        },
        {
          id: 'p2',
          formationId: 'formation-1',
          positionName: 'Center Mid',
          abbreviation: 'CM',
          sortOrder: 2,
          xPct: 50,
          yPct: 40,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-22T00:00:00.000Z',
        },
      ],
    });

    renderEditor();

    expect(await screen.findByRole('button', { name: /goalkeeper/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /center mid/i })).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
  });

  it('applies override when cold-load server positions appear stale', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-23T10:01:00.000Z'));
    getFormationLayoutOverrideMock.mockReturnValue({
      formationId: 'formation-1',
      savedAt: Date.parse('2026-04-23T10:00:00.000Z'),
      positions: [{ id: 'p1', xPct: 62, yPct: 24 }],
    });
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: 20,
          yPct: 80,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-23T09:59:00.000Z',
        },
      ],
    });

    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toHaveStyle('left: 62%; top: 24%;');
    expect(clearFormationLayoutOverrideMock).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });

  it('clears override and uses server positions when server coordinates already match override', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-23T10:01:00.000Z'));
    getFormationLayoutOverrideMock.mockReturnValue({
      formationId: 'formation-1',
      savedAt: Date.parse('2026-04-23T10:00:00.000Z'),
      positions: [{ id: 'p1', xPct: 62, yPct: 24 }],
    });
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: 62,
          yPct: 24,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-23T09:59:00.000Z',
        },
      ],
    });

    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toHaveStyle('left: 62%; top: 24%;');
    expect(clearFormationLayoutOverrideMock).toHaveBeenCalledWith('formation-1');
    dateNowSpy.mockRestore();
  });

  it('clears override and uses server positions when server rows are newer than override', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-23T10:01:00.000Z'));
    getFormationLayoutOverrideMock.mockReturnValue({
      formationId: 'formation-1',
      savedAt: Date.parse('2026-04-23T10:00:00.000Z'),
      positions: [{ id: 'p1', xPct: 62, yPct: 24 }],
    });
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: 20,
          yPct: 80,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-23T10:00:00.000Z',
        },
      ],
    });

    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toHaveStyle('left: 20%; top: 80%;');
    expect(clearFormationLayoutOverrideMock).toHaveBeenCalledWith('formation-1');
    dateNowSpy.mockRestore();
  });

  it('ignores expired override and clears it during cold load', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-23T10:10:00.000Z'));
    getFormationLayoutOverrideMock.mockReturnValue({
      formationId: 'formation-1',
      savedAt: Date.parse('2026-04-23T10:00:00.000Z'),
      positions: [{ id: 'p1', xPct: 62, yPct: 24 }],
    });
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
          formationId: 'formation-1',
          positionName: 'Goalkeeper',
          abbreviation: 'GK',
          sortOrder: 1,
          xPct: 20,
          yPct: 80,
          coaches: ['coach-1'],
          createdAt: '2026-04-22T00:00:00.000Z',
          updatedAt: '2026-04-23T09:59:00.000Z',
        },
      ],
    });

    renderEditor();

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toHaveStyle('left: 20%; top: 80%;');
    expect(clearFormationLayoutOverrideMock).toHaveBeenCalledWith('formation-1');
    dateNowSpy.mockRestore();
  });

  it('seeds from initialPositions and skips list query when initialPositions provided', async () => {
    const initialPositions = [
      { id: 'p1', positionName: 'Goalkeeper', abbreviation: 'GK', xPct: 20, yPct: 80 },
    ];

    render(
      <FormationVisualEditor
        formationId="formation-1"
        formationName="4-4-2"
        initialPositions={initialPositions}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    expect(node).toBeInTheDocument();
    expect(node).toHaveStyle('left: 20%; top: 80%;');
    expect(listMock).not.toHaveBeenCalled();
    expect(formationGetMock).toHaveBeenCalled();
  });

  it('onSaved is called with the saved coordinate array', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(
      <FormationVisualEditor
        formationId="formation-1"
        formationName="4-4-2"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    const node = await screen.findByRole('button', { name: /goalkeeper/i });
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'p1', xPct: 35, yPct: 77 }),
        ]),
      );
    });

    expect(setFormationLayoutOverrideMock).toHaveBeenCalledWith(
      'formation-1',
      expect.arrayContaining([
        expect.objectContaining({ id: 'p1', xPct: 35, yPct: 77 }),
      ]),
    );
  });
});
