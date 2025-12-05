import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

interface PlayerSelectProps {
  players: Player[];
  value: string;
  onChange: (value: string) => void;
  excludeId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function PlayerSelect({
  players,
  value,
  onChange,
  excludeId,
  placeholder = "Select player...",
  disabled = false,
  className = "",
}: PlayerSelectProps) {
  const filteredPlayers = excludeId 
    ? players.filter(p => p.id !== excludeId)
    : players;

  const sortedPlayers = [...filteredPlayers].sort(
    (a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0)
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`w-full p-2 border rounded ${className}`}
    >
      <option value="">{placeholder}</option>
      {sortedPlayers.map((player) => (
        <option key={player.id} value={player.id}>
          #{player.playerNumber} - {player.firstName} {player.lastName}
        </option>
      ))}
    </select>
  );
}
