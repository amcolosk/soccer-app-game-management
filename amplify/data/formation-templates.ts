export const FORMATION_TEMPLATES = [
  // 4v4 (4 field players)
  { 
    name: '1-2-1', 
    playerCount: 4,
    sport: 'Soccer',
    positions: [
      { name: 'Defender', abbr: 'D', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },
  { 
    name: '2-2', 
    playerCount: 4,
    sport: 'Soccer',
    positions: [
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Forward', abbr: 'LF', role: 'FORWARD' },
      { name: 'Right Forward', abbr: 'RF', role: 'FORWARD' }
    ]
  },

    // 5v5 (5 field players)
  { 
    name: '1-2-1', 
    playerCount: 5,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Defender', abbr: 'D', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },
  { 
    name: '2-2', 
    playerCount: 5,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Forward', abbr: 'LF', role: 'FORWARD' },
      { name: 'Right Forward', abbr: 'RF', role: 'FORWARD' }
    ]
  },
  
  // 7v7
  { 
    name: '2-3-1', 
    playerCount: 7,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Center Mid', abbr: 'CM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },
  { 
    name: '3-2-1', 
    playerCount: 7,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Center Defender', abbr: 'CD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },

  // 9v9
  { 
    name: '3-3-2', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Center Defender', abbr: 'CD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Center Mid', abbr: 'CM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Left Forward', abbr: 'LF', role: 'FORWARD' },
      { name: 'Right Forward', abbr: 'RF', role: 'FORWARD' }
    ]
  },
  { 
    name: '3-2-3', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Defender', abbr: 'LD', role: 'DEFENDER' },
      { name: 'Center Defender', abbr: 'CD', role: 'DEFENDER' },
      { name: 'Right Defender', abbr: 'RD', role: 'DEFENDER' },
      { name: 'Left Def Mid', abbr: 'LDM', role: 'MIDFIELDER' },
      { name: 'Right Def Mid', abbr: 'RDM', role: 'MIDFIELDER' },
      { name: 'Left Forward', abbr: 'LF', role: 'FORWARD' },
      { name: 'Center Forward', abbr: 'CF', role: 'FORWARD' },
      { name: 'Right Forward', abbr: 'RF', role: 'FORWARD' }
    ]
  },
  { 
    name: '4-3-1', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Back', abbr: 'LB', role: 'DEFENDER' },
      { name: 'Left Center Back', abbr: 'LCB', role: 'DEFENDER' },
      { name: 'Right Center Back', abbr: 'RCB', role: 'DEFENDER' },
      { name: 'Right Back', abbr: 'RB', role: 'DEFENDER' },
      { name: 'Left Mid', abbr: 'LM', role: 'MIDFIELDER' },
      { name: 'Center Mid', abbr: 'CM', role: 'MIDFIELDER' },
      { name: 'Right Mid', abbr: 'RM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },

  // 11v11
  { 
    name: '4-2-3-1', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Back', abbr: 'LB', role: 'DEFENDER' },
      { name: 'Left Center Back', abbr: 'LCB', role: 'DEFENDER' },
      { name: 'Right Center Back', abbr: 'RCB', role: 'DEFENDER' },
      { name: 'Right Back', abbr: 'RB', role: 'DEFENDER' },
      { name: 'Left Def Mid', abbr: 'LDM', role: 'MIDFIELDER' },
      { name: 'Right Def Mid', abbr: 'RDM', role: 'MIDFIELDER' },
      { name: 'Left Att Mid', abbr: 'LAM', role: 'MIDFIELDER' },
      { name: 'Center Att Mid', abbr: 'CAM', role: 'MIDFIELDER' },
      { name: 'Right Att Mid', abbr: 'RAM', role: 'MIDFIELDER' },
      { name: 'Forward', abbr: 'F', role: 'FORWARD' }
    ]
  },
  { 
    name: '4-3-3', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Back', abbr: 'LB', role: 'DEFENDER' },
      { name: 'Left Center Back', abbr: 'LCB', role: 'DEFENDER' },
      { name: 'Right Center Back', abbr: 'RCB', role: 'DEFENDER' },
      { name: 'Right Back', abbr: 'RB', role: 'DEFENDER' },
      { name: 'Left Center Mid', abbr: 'LCM', role: 'MIDFIELDER' },
      { name: 'Center Mid', abbr: 'CM', role: 'MIDFIELDER' },
      { name: 'Right Center Mid', abbr: 'RCM', role: 'MIDFIELDER' },
      { name: 'Left Wing', abbr: 'LW', role: 'FORWARD' },
      { name: 'Center Forward', abbr: 'CF', role: 'FORWARD' },
      { name: 'Right Wing', abbr: 'RW', role: 'FORWARD' }
    ]
  },
  { 
    name: '3-5-2', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK', role: 'GOALKEEPER' },
      { name: 'Left Center Back', abbr: 'LCB', role: 'DEFENDER' },
      { name: 'Center Back', abbr: 'CB', role: 'DEFENDER' },
      { name: 'Right Center Back', abbr: 'RCB', role: 'DEFENDER' },
      { name: 'Left Wing Back', abbr: 'LWB', role: 'DEFENDER' },
      { name: 'Left Center Mid', abbr: 'LCM', role: 'MIDFIELDER' },
      { name: 'Center Mid', abbr: 'CM', role: 'MIDFIELDER' },
      { name: 'Right Center Mid', abbr: 'RCM', role: 'MIDFIELDER' },
      { name: 'Right Wing Back', abbr: 'RWB', role: 'DEFENDER' },
      { name: 'Left Forward', abbr: 'LF', role: 'FORWARD' },
      { name: 'Right Forward', abbr: 'RF', role: 'FORWARD' }
    ]
  },
];
