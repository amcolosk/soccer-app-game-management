export const FORMATION_TEMPLATES = [
  // 4v4 (4 field players)
  { 
    name: '1-2-1', 
    playerCount: 4,
    sport: 'Soccer',
    positions: [
      { name: 'Defender', abbr: 'D' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },
  { 
    name: '2-2', 
    playerCount: 4,
    sport: 'Soccer',
    positions: [
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Forward', abbr: 'LF' },
      { name: 'Right Forward', abbr: 'RF' }
    ]
  },

    // 5v5 (5 field players)
  { 
    name: '1-2-1', 
    playerCount: 5,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Defender', abbr: 'D' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },
  { 
    name: '2-2', 
    playerCount: 5,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Forward', abbr: 'LF' },
      { name: 'Right Forward', abbr: 'RF' }
    ]
  },
  
  // 7v7
  { 
    name: '2-3-1', 
    playerCount: 7,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Center Mid', abbr: 'CM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },
  { 
    name: '3-2-1', 
    playerCount: 7,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Center Defender', abbr: 'CD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },

  // 9v9
  { 
    name: '3-3-2', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Center Defender', abbr: 'CD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Center Mid', abbr: 'CM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Left Forward', abbr: 'LF' },
      { name: 'Right Forward', abbr: 'RF' }
    ]
  },
  { 
    name: '3-2-3', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Defender', abbr: 'LD' },
      { name: 'Center Defender', abbr: 'CD' },
      { name: 'Right Defender', abbr: 'RD' },
      { name: 'Left Def Mid', abbr: 'LDM' },
      { name: 'Right Def Mid', abbr: 'RDM' },
      { name: 'Left Forward', abbr: 'LF' },
      { name: 'Center Forward', abbr: 'CF' },
      { name: 'Right Forward', abbr: 'RF' }
    ]
  },
  { 
    name: '4-3-1', 
    playerCount: 9,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Back', abbr: 'LB' },
      { name: 'Left Center Back', abbr: 'LCB' },
      { name: 'Right Center Back', abbr: 'RCB' },
      { name: 'Right Back', abbr: 'RB' },
      { name: 'Left Mid', abbr: 'LM' },
      { name: 'Center Mid', abbr: 'CM' },
      { name: 'Right Mid', abbr: 'RM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },

  // 11v11
  { 
    name: '4-2-3-1', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Back', abbr: 'LB' },
      { name: 'Left Center Back', abbr: 'LCB' },
      { name: 'Right Center Back', abbr: 'RCB' },
      { name: 'Right Back', abbr: 'RB' },
      { name: 'Left Def Mid', abbr: 'LDM' },
      { name: 'Right Def Mid', abbr: 'RDM' },
      { name: 'Left Att Mid', abbr: 'LAM' },
      { name: 'Center Att Mid', abbr: 'CAM' },
      { name: 'Right Att Mid', abbr: 'RAM' },
      { name: 'Forward', abbr: 'F' }
    ]
  },
  { 
    name: '4-3-3', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Back', abbr: 'LB' },
      { name: 'Left Center Back', abbr: 'LCB' },
      { name: 'Right Center Back', abbr: 'RCB' },
      { name: 'Right Back', abbr: 'RB' },
      { name: 'Left Center Mid', abbr: 'LCM' },
      { name: 'Center Mid', abbr: 'CM' },
      { name: 'Right Center Mid', abbr: 'RCM' },
      { name: 'Left Wing', abbr: 'LW' },
      { name: 'Center Forward', abbr: 'CF' },
      { name: 'Right Wing', abbr: 'RW' }
    ]
  },
  { 
    name: '3-5-2', 
    playerCount: 11,
    sport: 'Soccer',
    positions: [
      { name: 'Goalkeeper', abbr: 'GK' },
      { name: 'Left Center Back', abbr: 'LCB' },
      { name: 'Center Back', abbr: 'CB' },
      { name: 'Right Center Back', abbr: 'RCB' },
      { name: 'Left Wing Back', abbr: 'LWB' },
      { name: 'Left Center Mid', abbr: 'LCM' },
      { name: 'Center Mid', abbr: 'CM' },
      { name: 'Right Center Mid', abbr: 'RCM' },
      { name: 'Right Wing Back', abbr: 'RWB' },
      { name: 'Left Forward', abbr: 'LF' },
      { name: 'Right Forward', abbr: 'RF' }
    ]
  },
];
