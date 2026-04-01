import type { PlayerWithRoster } from '../types/schema';

interface PlayerSelectProps {
  players: PlayerWithRoster[];
  value: string;
  onChange: (value: string) => void;
  excludeId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  onFieldPlayerIds?: string[];
}

function renderPlayerOption(player: PlayerWithRoster) {
  return (
    <option key={player.id} value={player.id}>
      #{player.playerNumber} - {player.firstName} {player.lastName}
    </option>
  );
}

export function PlayerSelect({
  players,
  value,
  onChange,
  excludeId,
  placeholder = "Select player...",
  disabled = false,
  className = "",
  id,
  onFieldPlayerIds,
}: PlayerSelectProps) {
  const filteredPlayers = excludeId 
    ? players.filter(p => p.id !== excludeId)
    : players;

  const sortByNumber = (a: PlayerWithRoster, b: PlayerWithRoster) =>
    (a.playerNumber ?? 0) - (b.playerNumber ?? 0);

  if (onFieldPlayerIds !== undefined) {
    const onFieldSet = new Set(onFieldPlayerIds);
    const onFieldPlayers = [...filteredPlayers]
      .filter(p => onFieldSet.has(p.id))
      .sort(sortByNumber);
    const benchPlayers = [...filteredPlayers]
      .filter(p => !onFieldSet.has(p.id))
      .sort(sortByNumber);

    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full p-2 border rounded ${className}`}
      >
        <option value="">{placeholder}</option>
        {onFieldPlayers.length > 0 && (
          <optgroup label="🟢 On Field">
            {onFieldPlayers.map(renderPlayerOption)}
          </optgroup>
        )}
        {benchPlayers.length > 0 && (
          <optgroup label="⬛ Bench">
            {benchPlayers.map(renderPlayerOption)}
          </optgroup>
        )}
      </select>
    );
  }

  const sortedPlayers = [...filteredPlayers].sort(sortByNumber);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`w-full p-2 border rounded ${className}`}
    >
      <option value="">{placeholder}</option>
      {sortedPlayers.map(renderPlayerOption)}
    </select>
  );
}
