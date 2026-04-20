export type GameActionKind = 'primary' | 'destructive';

export interface GameActionConfirmDialog {
  title: string;
  body: string;
  authorReminder?: string;
  confirmText: string;
  cancelText: string;
}

export interface GameActionDescriptor {
  id: 'edit' | 'delete';
  label: string;
  kind: GameActionKind;
  ariaLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  srStatusText?: string;
  confirmDialog?: GameActionConfirmDialog;
  onAction: () => Promise<void> | void;
}

export function sortGameActions(actions: GameActionDescriptor[]): GameActionDescriptor[] {
  const order = ['edit', 'delete'];
  return [...actions].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
