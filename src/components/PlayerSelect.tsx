import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

interface PlayerWithRoster extends Player {
  playerNumber?: number;
}

interface PlayerSelectProps {
  players: PlayerWithRoster[];
  value: string;
  onChange: (value: string) => void;
  excludeId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
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
}: PlayerSelectProps) {
  const filteredPlayers = excludeId 
    ? players.filter(p => p.id !== excludeId)
    : players;

  const sortedPlayers = [...filteredPlayers].sort(
    (a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0)
  );

  return (
    <select
      id={id}
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
