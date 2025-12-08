import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  selectOption,
  waitForElement,
  getTextContent,
  formatTime,
} from './helpers';

/**
 * Comprehensive E2E Test Suite for Soccer App
 * Tests the complete workflow from login to season reporting
 */

// Test data
const TEST_DATA = {
  season: {
    name: 'Fall 2025',
    year: '2025',
  },
  team: {
    name: 'Thunder FC U10',
    halfLength: '25',
    maxPlayers: '7',
  },
  positions: [
    { name: 'Goalkeeper', abbreviation: 'GK' },
    { name: 'Left Defender', abbreviation: 'LD' },
    { name: 'Right Defender', abbreviation: 'RD' },
    { name: 'Center Midfielder', abbreviation: 'CM' },
    { name: 'Left Midfielder', abbreviation: 'LM' },
    { name: 'Right Midfielder', abbreviation: 'RM' },
    { name: 'Forward', abbreviation: 'FWD' },
  ],
  players: [
    { number: '1', firstName: 'Alice', lastName: 'Anderson', position: 'GK' },
    { number: '2', firstName: 'Bob', lastName: 'Brown', position: 'LD' },
    { number: '3', firstName: 'Charlie', lastName: 'Clark', position: 'RD' },
    { number: '4', firstName: 'Diana', lastName: 'Davis', position: 'CM' },
    { number: '5', firstName: 'Ethan', lastName: 'Evans', position: 'LM' },
    { number: '6', firstName: 'Fiona', lastName: 'Fisher', position: 'RM' },
    { number: '7', firstName: 'George', lastName: 'Garcia', position: 'FWD' },
    { number: '8', firstName: 'Hannah', lastName: 'Harris', position: 'CM' },
  ],
  game1: {
    opponent: 'Lightning FC',
    date: '2025-11-30T14:00',
    isHome: true,
  },
  game2: {
    opponent: 'Thunder Strikers',
    date: '2025-12-07T15:00',
    isHome: false,
  },
};

// Helper to login (adjust based on your auth setup)
async function login(page: Page) {
  await page.goto('/');
  await waitForPageLoad(page);
  
  // Wait for Amplify auth UI to load
  // Note: You may need to adjust these selectors based on your actual auth UI
  await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
  
  // If using email/password auth in sandbox
  await fillInput(page, 'input[name="username"], input[type="email"]', 'test@example.com');
  await fillInput(page, 'input[name="password"], input[type="password"]', 'TestPassword123!');
  await clickButton(page, 'Sign in');

  // Click Skip Verification
  await clickButton(page, 'Skip');
  
  // Wait for successful login
  await page.waitForSelector('text=Season', { timeout: 10000 });
  await waitForPageLoad(page);
}

// Helper to clean up existing seasons
async function cleanupExistingSeasons(page: Page) {
  console.log('Cleaning up existing seasons...');
  
  // Wait for any existing season cards to load
  await page.waitForTimeout(1000);
  
  // Find all delete buttons (✕) on season cards
  let deleteButtons = page.locator('.season-card .btn-delete');
  let count = await deleteButtons.count();
  
  if (count > 0) {
    console.log(`Found ${count} existing season(s), deleting...`);
    
    // Set up persistent dialog handler for all confirmations
    page.on('dialog', async (dialog) => {
      console.log(`Auto-confirming: ${dialog.message()}`);
      await dialog.accept();
    });
    
    // Delete all existing seasons one by one
    while (count > 0) {
      // Click the first delete button
      const firstDeleteButton = page.locator('.season-card .btn-delete').first();
      await firstDeleteButton.click();
      
      // Wait for deletion to complete and UI to update
      await page.waitForTimeout(2000);
      await waitForPageLoad(page);
      
      // Re-check count
      deleteButtons = page.locator('.season-card .btn-delete');
      const newCount = await deleteButtons.count();
      
      if (newCount === count) {
        console.log('⚠️ Season count did not decrease, stopping cleanup');
        break;
      }
      
      count = newCount;
      console.log(`Remaining seasons: ${count}`);
    }
    
    // Remove the dialog handler
    page.removeAllListeners('dialog');
    
    console.log('✓ Existing seasons deleted');
  } else {
    console.log('✓ No existing seasons to clean up');
  }
}

// Helper to create a season
async function createSeason(page: Page) {
  console.log('Creating season...');
  
  // Navigate to seasons and create new season
  await clickButton(page, '+ Create New Season');
  await waitForPageLoad(page);
  
  // Fill season form
  await fillInput(page, 'input[placeholder*="Season Name (e.g., Fall League)"]', TEST_DATA.season.name);
  await fillInput(page, 'input[placeholder*="Year (e.g., 2025)"]', TEST_DATA.season.year);
  
  await clickButton(page, 'Create');
  await waitForPageLoad(page);
  
  // Verify season was created
  await expect(page.getByText(TEST_DATA.season.name)).toBeVisible();
  console.log('✓ Season created');
}

// Helper to create a team
async function createTeam(page: Page) {
  console.log('Creating team...');
  
  // Click on the season to enter it
  await page.getByText(TEST_DATA.season.name).click();
  await waitForPageLoad(page);
  
  // Create team
  await clickButton(page, '+ Create New Team');
  await waitForPageLoad(page);
  
  // Fill team form
  await fillInput(page, 'input[id="teamName"]', TEST_DATA.team.name);
  await fillInput(page, 'input[id="halfLength"]', TEST_DATA.team.halfLength);
  await fillInput(page, 'input[id="maxPlayers"]', TEST_DATA.team.maxPlayers);
  
  await clickButton(page, 'Create');
  await waitForPageLoad(page);
  
  // Verify team was created
  await expect(page.getByText(TEST_DATA.team.name)).toBeVisible();
  console.log('✓ Team created');
}

// Helper to create positions
async function createPositions(page: Page) {
  console.log('Creating positions...');
  
  // Click on the team to enter it
  await page.getByText(TEST_DATA.team.name).click();
  await waitForPageLoad(page);
  
  // Go to Positions tab
  await clickButton(page, 'Positions');
  await waitForPageLoad(page);
  
  // Create each position
  for (const position of TEST_DATA.positions) {
    await clickButton(page, 'Add Position');
    await waitForPageLoad(page);
    
    await fillInput(page, 'input[placeholder*="Position Name *"]', position.name);
    await fillInput(page, 'input[placeholder*="Abbreviation (e.g., FW, MF, DF)"]', position.abbreviation);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(500);
    
    // Verify position was created
    await expect(page.getByText(position.name)).toBeVisible();
  }
  
  console.log(`✓ Created ${TEST_DATA.positions.length} positions`);
}

// Helper to create players
async function createPlayers(page: Page) {
  console.log('Creating players...');
  
  // Go to Players tab
  await clickButton(page, 'Players');
  await waitForPageLoad(page);
  
  // Create each player
  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);
    
    await fillInput(page, 'input[placeholder*="Player Number *"]', player.number);
    await fillInput(page, 'input[placeholder*="First Name *"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last Name *"]', player.lastName);
    
    // Select preferred position checkbox
    const positionCheckbox = page.locator('.checkbox-label', { hasText: `${player.position} -` });
    if (await positionCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      await positionCheckbox.locator('input[type="checkbox"]').check();
      await page.waitForTimeout(200);
    }
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(500);
    
    // Verify player was created
    await expect(page.getByText(`${player.firstName} ${player.lastName}`)).toBeVisible();
  }
  
  console.log(`✓ Created ${TEST_DATA.players.length} players`);
}

// Helper to create and setup a game
async function createGame(page: Page, gameData: { opponent: string; date: string; isHome: boolean }) {
  console.log(`Creating game vs ${gameData.opponent}...`);
  
  // Go to Games tab (if not already there)
  const gamesTab = page.locator('button', { hasText: 'Games' });
  if (await gamesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await clickButton(page, 'Games');
    await waitForPageLoad(page);
  }
  
  // Create game
  await clickButton(page, '+ Schedule New Game');
  await waitForPageLoad(page);
  
  // Fill game form
  await fillInput(page, 'input[placeholder*="Opponent Team Name *"]', gameData.opponent);
  
  await fillInput(page, 'input[type="datetime-local"]', gameData.date);

  
  // Select home/away using getByRole for better reliability
  if (gameData.isHome) {
    await page.getByRole('radio', { name: /home/i }).check();
  } else {
    await page.getByRole('radio', { name: /away/i }).check();
  }
  
  await clickButton(page, 'Create');
  await waitForPageLoad(page);
  
  // Verify game was created
  await expect(page.getByText(gameData.opponent)).toBeVisible();
  console.log(`✓ Game created vs ${gameData.opponent}`);
}

// Helper to setup lineup for the game
async function setupLineup(page: Page, opponent: string) {
  console.log(`Setting up lineup for game vs ${opponent}...`);
  
  // Click on the game to manage it
  await page.getByText(opponent).click();
  await waitForPageLoad(page);
  
  // Assign first 7 players to starting positions
  const startingPlayers = TEST_DATA.players.slice(0, 7);
  
  for (let i = 0; i < startingPlayers.length; i++) {
    const player = startingPlayers[i];
    
    // Click on the player
    await page.getByText(`${player.firstName} ${player.lastName}`).click();
    await page.waitForTimeout(300);
    
    // Click on the corresponding position (they're in order)
    const positionButtons = page.locator('.position-picker-btn:not(.occupied)');
    const count = await positionButtons.count();
    
    if (count > 0) {
      await positionButtons.first().click();
      await page.waitForTimeout(500);
    }
  }
  
  console.log('✓ Lineup set up with 7 starters');
}

// Helper to run the game simulation
async function runGame(page: Page, gameNumber: number = 1) {
  console.log(`Running game ${gameNumber} simulation...`);
  
  // Start the game
  await clickButton(page, 'Start Game');
  await page.waitForTimeout(1000);
  
  // Verify timer is running
  await expect(page.locator('.timer-display')).toBeVisible();
  
  // Add test time to simulate game progress
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // Record a goal for us (vary by game)
  await clickButtonByText(page, /Goal - Us/);
  await page.waitForTimeout(500);
  
  // Select scorer - different players for each game
  const scorerSelect = page.locator('select#goalScorer');
  if (gameNumber === 1) {
    await scorerSelect.selectOption({ label: '#6 - Fiona Fisher' });
  } else {
    await scorerSelect.selectOption({ label: '#7 - George Garcia' });
  }
  await page.waitForTimeout(300);
  
  // Select assist - different players for each game
  const assistSelect = page.locator('select#goalAssist');
  if (gameNumber === 1) {
    await assistSelect.selectOption({ label: '#4 - Diana Davis' });
  } else {
    await assistSelect.selectOption({ label: '#5 - Ethan Evans' });
  }
  await page.waitForTimeout(300);
  
  await clickButton(page, 'Record Goal');
  await page.waitForTimeout(1000);
  
  // Verify score updated
  await expect(page.locator('.score-display')).toContainText('1');
  console.log(`✓ Goal ${gameNumber}.1 recorded`);
  
  // Add more time
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // Record a gold star (vary by game)
  await clickButtonByText(page, /Gold Star/);
  await page.waitForTimeout(500);
  
  const notePlayerSelect = page.locator('select#notePlayer');
  if (gameNumber === 1) {
    await notePlayerSelect.selectOption({ label: '#1 - Alice Anderson' });
    await fillInput(page, 'textarea#noteText', 'Great save!');
  } else {
    await notePlayerSelect.selectOption({ label: '#2 - Bob Brown' });
    await fillInput(page, 'textarea#noteText', 'Excellent defense!');
  }
  await page.waitForTimeout(300);
  
  await clickButton(page, 'Save Note');
  await page.waitForTimeout(1000);
  
  console.log(`✓ Gold star ${gameNumber} recorded`);
  
  // Make a substitution (Diana Davis at CM for Hannah Harris)
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // Find the position card for Diana Davis (CM) and click its substitute button
  const dianaCard = page.locator('.position-card').filter({ hasText: 'Diana Davis' });
  const dianaSubButton = dianaCard.locator('button.btn-substitute[title="Make substitution"]');
  
  if (await dianaSubButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('Found Diana\'s position, making substitution...');
    await dianaSubButton.click();
    await page.waitForTimeout(500);
    
    // Wait for substitution modal to appear
    await page.waitForSelector('.sub-player-item', { timeout: 5000 });
    
    // Find Hannah Harris in the substitution list and click "Sub Now"
    const hannahItem = page.locator('.sub-player-item').filter({ hasText: 'Hannah Harris' });
    await expect(hannahItem).toBeVisible();
    
    const subNowButton = hannahItem.locator('button.btn-sub-now');
    await subNowButton.click();
    await page.waitForTimeout(1000);
    
    // Verify the modal closed
    await expect(page.locator('.sub-player-item')).not.toBeVisible();
    
    console.log('✓ Substitution made (Diana → Hannah at CM)');
  } else {
    console.log('⚠️ Could not find Diana\'s position for substitution, skipping');
  }
  
  // Add time to reach halftime
  await clickButton(page, '+5 min');
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // End first half
  await clickButton(page, 'End First Half');
  await page.waitForTimeout(1000);
  
  // Verify halftime status
  await expect(page.getByText(/Halftime/)).toBeVisible();
  console.log('✓ First half ended');
  
  // Start second half
  await clickButton(page, 'Start Second Half');
  await page.waitForTimeout(1000);
  
  // Add time in second half
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // Record another goal (second goal of the game)
  await clickButtonByText(page, /Goal - Us/);
  await page.waitForTimeout(500);
  
  const scorerSelect2 = page.locator('select#goalScorer');
  if (gameNumber === 1) {
    await scorerSelect2.selectOption({ label: '#7 - George Garcia' });
  } else {
    await scorerSelect2.selectOption({ label: '#6 - Fiona Fisher' });
  }
  await page.waitForTimeout(300);
  
  await clickButton(page, 'Record Goal');
  await page.waitForTimeout(1000);
  
  // Verify score is now 2
  const scoreElements = page.locator('.score-display .score');
  await expect(scoreElements.first()).toContainText('2');
  console.log(`✓ Goal ${gameNumber}.2 recorded`);
  
  // Add more time and end game
  await clickButton(page, '+5 min');
  await clickButton(page, '+5 min');
  await clickButton(page, '+5 min');
  await page.waitForTimeout(500);
  
  // End the game
  await clickButton(page, 'End Game');
  await page.waitForTimeout(1000);
  
  // Verify game completed
  await expect(page.getByText(/Game Completed/)).toBeVisible();
  console.log(`✓ Game ${gameNumber} completed`);
  
  // Navigate back to Games list for next game (if not the last game)
  if (gameNumber === 1) {
    await clickButtonByText(page, /Back to Games/);
    await waitForPageLoad(page);
    console.log('✓ Returned to Games list');
  }
  
  // Return game statistics
  if (gameNumber === 1) {
    return {
      goals: 2,
      assists: 1,
      goldStars: 1,
      scorers: ['Fiona Fisher', 'George Garcia'],
    };
  } else {
    return {
      goals: 2,
      assists: 1,
      goldStars: 1,
      scorers: ['George Garcia', 'Fiona Fisher'], // Both scored in game 2 as well
    };
  }
}

// Helper to verify season totals
async function verifySeasonTotals(page: Page, gameData: any) {
  console.log('Verifying season totals...');
  
  // Go back to team view
  await clickButtonByText(page, /Back to Games/);
  await waitForPageLoad(page);
  
  // Open Season Report
  await clickButton(page, 'Reports');
  await waitForPageLoad(page);
  
  // Verify total goals in summary
  const goalsSummary = page.locator('.summary-card').filter({ hasText: 'Total Goals' });
  await expect(goalsSummary.locator('.summary-value')).toContainText(gameData.goals.toString());
  console.log(`✓ Total goals verified: ${gameData.goals}`);
  
  // Verify total assists
  const assistsSummary = page.locator('.summary-card').filter({ hasText: 'Total Assists' });
  await expect(assistsSummary.locator('.summary-value')).toContainText(gameData.assists.toString());
  console.log(`✓ Total assists verified: ${gameData.assists}`);
  
  // Verify gold stars
  const starsSummary = page.locator('.summary-card').filter({ hasText: 'Gold Stars' });
  await expect(starsSummary.locator('.summary-value')).toContainText(gameData.goldStars.toString());
  console.log(`✓ Total gold stars verified: ${gameData.goldStars}`);
  
  // Verify individual player stats
  for (const scorer of gameData.scorers) {
    const playerRow = page.locator('tr').filter({ hasText: scorer });
    await expect(playerRow).toBeVisible();
    
    // Check that the player has at least 1 goal
    const goalsCell = playerRow.locator('.stat-goals');
    const goalsText = await goalsCell.textContent();
    expect(parseInt(goalsText || '0')).toBeGreaterThan(0);
  }
  console.log('✓ Individual player stats verified');
  
  // Click on a player to see details
  const fionaRow = page.locator('tr').filter({ hasText: 'Diana Davis' });
  await fionaRow.click();
  await page.waitForTimeout(1000);
  
  // Verify player details section appears
  await expect(page.locator('.player-details-section')).toBeVisible();
  
  // Verify goals section exists
  await expect(page.locator('h3').filter({ hasText: /Assists/ })).toBeVisible();
  
  // Verify play time by position
  await expect(page.locator('h3').filter({ hasText: /Play Time by Position/ })).toBeVisible();

  // Verify specific position time (Forward - 40 minutes)
  const positionTimeItem = page.locator('.position-time-item', { hasText: 'Center Midfielder' });
  await expect(positionTimeItem).toBeVisible();
  await expect(positionTimeItem.locator('.position-name')).toContainText('Center Midfielder');
  await expect(positionTimeItem.locator('.position-time')).toContainText('1h 30m');
  console.log('✓ Position time verified: Center Midfielder 1h 30m');
  
  console.log('✓ Player details verified');
}

// Main test
test.describe('Soccer App Full Workflow', () => {
  test('Complete workflow from login to season reporting', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for full workflow
    
    console.log('\n=== Starting E2E Test Suite ===\n');
    
    // Step 1: Login
    console.log('Step 1: Login');
    await login(page);
    console.log('✓ Logged in successfully\n');
    
    // Step 1.5: Clean up existing seasons
    console.log('Step 1.5: Clean up existing data');
    await cleanupExistingSeasons(page);
    console.log('');
    
    // Step 2: Create Season
    console.log('Step 2: Create Season');
    await createSeason(page);
    console.log('');
    
    // Step 3: Create Team
    console.log('Step 3: Create Team');
    await createTeam(page);
    console.log('');
    
    // Step 4: Create Positions
    console.log('Step 4: Create Positions');
    await createPositions(page);
    console.log('');
    
    // Step 5: Create Players
    console.log('Step 5: Create Players');
    await createPlayers(page);
    console.log('');
    
    // Step 6: Create Game 1
    console.log('Step 6: Create Game 1');
    await createGame(page, TEST_DATA.game1);
    console.log('');
    
    // Step 7: Setup Lineup for Game 1
    console.log('Step 7: Setup Lineup for Game 1');
    await setupLineup(page, TEST_DATA.game1.opponent);
    console.log('');
    
    // Step 8: Run Game 1
    console.log('Step 8: Run Game 1 Simulation');
    const game1Data = await runGame(page, 1);
    console.log('');
    
    // Step 9: Create Game 2
    console.log('Step 9: Create Game 2');
    await createGame(page, TEST_DATA.game2);
    console.log('');
    
    // Step 10: Setup Lineup for Game 2
    console.log('Step 10: Setup Lineup for Game 2');
    await setupLineup(page, TEST_DATA.game2.opponent);
    console.log('');
    
    // Step 11: Run Game 2 (different scorers and assists)
    console.log('Step 11: Run Game 2 Simulation');
    const game2Data = await runGame(page, 2);
    console.log('');
    
    // Step 12: Verify Season Totals (aggregate of both games)
    console.log('Step 12: Verify Season Totals (Both Games)');
    const aggregateData = {
      goals: game1Data.goals + game2Data.goals,
      assists: game1Data.assists + game2Data.assists,
      goldStars: game1Data.goldStars + game2Data.goldStars,
      scorers: [...new Set([...game1Data.scorers, ...game2Data.scorers])], // unique scorers
    };
    await verifySeasonTotals(page, aggregateData);
    console.log('');
    
    console.log('=== E2E Test Suite Completed Successfully ===\n');
  });
});
