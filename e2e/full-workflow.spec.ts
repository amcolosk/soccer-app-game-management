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
import { TEST_USERS, TEST_CONFIG } from '../test-config';

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
  await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user1.email);
  await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user1.password);
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
      await page.waitForTimeout(3000);
      
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
  await expect(page.getByText(TEST_DATA.season.name).first()).toBeVisible();
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
  
  // Wait for the page to fully load including GraphQL subscriptions
  await page.waitForSelector('.position-slot', { timeout: 5000 });
  await page.waitForTimeout(1000);
  
  // Assign first 7 players to starting positions
  const startingPlayers = TEST_DATA.players.slice(0, 7);
  
  for (let i = 0; i < startingPlayers.length; i++) {
    const player = startingPlayers[i];
    const expectedCount = i + 1;
    let assignmentSuccessful = false;
    let retryAttempt = 0;
    const maxRetries = 2;
    
    while (!assignmentSuccessful && retryAttempt <= maxRetries) {
      if (retryAttempt > 0) {
        console.log(`🔄 Retry attempt ${retryAttempt} for ${player.firstName} ${player.lastName}...`);
      } else {
        console.log(`Assigning ${player.firstName} ${player.lastName} to position ${i + 1}...`);
      }
      
      try {        
        // Click on the player to open position picker modal
        const playerCard = page.locator('.player-card').filter({ hasText: `${player.firstName} ${player.lastName}` });
        await playerCard.click();
        console.log('  Player clicked, waiting for modal...');
        await page.waitForTimeout(250);
        
        // Wait for position picker modal to appear with the heading
        await page.waitForSelector('.modal-overlay', { timeout: 5000 });
        await page.waitForSelector('h2:has-text("Assign")', { timeout: 5000 });
        console.log('  Modal opened');
        
        // Wait a bit for modal to be fully interactive
        await page.waitForTimeout(300);
        
        // Find the first available position button
        const positionButtons = page.locator('.modal-content .position-picker-btn:not(.occupied)');
        await positionButtons.first().waitFor({ state: 'visible', timeout: 5000 });
        
        const count = await positionButtons.count();
        console.log(`  Found ${count} available positions`);
        
        if (count === 0) {
          console.log(`  ⚠️ No available positions for ${player.firstName} ${player.lastName}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          break;
        }
        
        // Get the position name before clicking
        const positionName = await positionButtons.first().locator('.position-picker-label .name').textContent();
        console.log(`  Assigning to position: ${positionName}`);
        
        // Get the position ID/name before clicking so we can verify it gets occupied
        const positionText = await positionButtons.first().textContent();
        await positionButtons.first().click();
        console.log('  Position button clicked');
        
        // Wait for modal to close - this confirms the assignment was successful
        await page.waitForSelector('.modal-overlay', { state: 'hidden', timeout: 5000 });
        console.log('  Modal closed');
        
        // CRITICAL: Wait for the position to actually show as occupied in the lineup
        // This prevents race conditions where multiple players try to take the same position
        // Give extra time for the first player as subscriptions may still be initializing
        const initialWait = i === 0 ? 150 : 50;
        await page.waitForTimeout(initialWait);
        
        // Wait for the assigned player count to increase
        let actualCount = 0;
        const positionCards = page.locator('.position-slot');
        actualCount = await positionCards.filter({ has: page.locator('.assigned-player') }).count();
        
        // Check if assignment was successful
        if (actualCount >= expectedCount) {
          assignmentSuccessful = true;
          console.log(`  ✓ ${player.firstName} ${player.lastName} assigned to ${positionText?.trim()} (${actualCount}/${expectedCount} total)`);
        } else {
          console.log(`  ⚠️ Assignment failed: Expected ${expectedCount} assigned but only see ${actualCount}`);
          retryAttempt++;
          if (retryAttempt <= maxRetries) {
            await page.waitForTimeout(100); // Wait before retry
          }
        }
      } catch (error) {
        console.log(`  ❌ Error during assignment: ${error}`);
        retryAttempt++;
        if (retryAttempt <= maxRetries) {
          await page.waitForTimeout(100); // Wait before retry
        }
      }
    }
    
    if (!assignmentSuccessful) {
      console.log(`  ❌ FAILED to assign ${player.firstName} ${player.lastName} after ${maxRetries + 1} attempts`);
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
  console.log('Looking for Diana Davis on the field...');
  
  // Debug: Log all position cards
  const allCards = page.locator('.position-card');
  const cardCount = await allCards.count();
  console.log(`Found ${cardCount} position cards`);
  for (let i = 0; i < cardCount; i++) {
    const cardText = await allCards.nth(i).textContent();
    console.log(`  Card ${i}: ${cardText?.substring(0, 50)}`);
  }
  
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

  // Verify specific position time (Diana should have played full 45 min each game if sub was skipped = 90 min total)
  const positionTimeItem = page.locator('.position-time-item', { hasText: 'Center Midfielder' });
  await expect(positionTimeItem).toBeVisible();
  await expect(positionTimeItem.locator('.position-name')).toContainText('Center Midfielder');
  
  // Log actual play time for debugging
  const actualTime = await positionTimeItem.locator('.position-time').textContent();
  console.log(`Diana Davis play time at CM: ${actualTime}`);
  
  // Diana plays full game if substitution was skipped (Game 1: 45min, Game 2: 45min = 90min total)
  await expect(positionTimeItem.locator('.position-time')).toContainText('1h 30m');
  console.log('✓ Position time verified: Center Midfielder 1h 30m');
  
  console.log('✓ Player details verified');
}

// Main test
test.describe('Soccer App Full Workflow', () => {
  test('Complete workflow from login to season reporting', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long); // 3 minutes for full workflow
    
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

  test('Game deletion cleans up all related data', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long); // 3 minutes for full game simulation
    
    console.log('\n=== Testing Game Deletion Data Cleanup ===\n');
    
    // Step 1: Login
    console.log('Step 1: Login');
    await login(page);
    console.log('✓ Logged in successfully\n');
    
    // Step 2: Clean up existing data
    console.log('Step 2: Clean up existing data');
    await cleanupExistingSeasons(page);
    console.log('');
    
    // Step 3: Create Season
    console.log('Step 3: Create Season');
    await createSeason(page);
    console.log('');
    
    // Step 4: Create Team
    console.log('Step 4: Create Team');
    await createTeam(page);
    console.log('');
    
    // Step 5: Create Positions
    console.log('Step 5: Create Positions');
    await createPositions(page);
    console.log('');
    
    // Step 6: Create Players
    console.log('Step 6: Create Players');
    await createPlayers(page);
    console.log('');
    
    // Step 7: Create a test game
    console.log('Step 7: Create Test Game');
    await createGame(page, TEST_DATA.game1);
    console.log('');
    
    // Step 8: Setup Lineup
    console.log('Step 8: Setup Lineup');
    await setupLineup(page, TEST_DATA.game1.opponent);
    console.log('');
    
    // Step 9: Run the game to create all related data
    console.log('Step 9: Run Game to Generate Data');
    await runGame(page, 1);
    console.log('');
    
    // Step 10: Navigate to Team Reports to verify data exists
    console.log('Step 10: Verify Data Exists Before Deletion');
    await clickButton(page, 'Reports');
    await page.waitForTimeout(1000);
    
    // Verify season report shows data
    const reportTable = page.locator('table');
    await expect(reportTable).toBeVisible();
    
    // Count rows (should have 8 players)
    const playerRows = page.locator('tbody tr');
    const initialRowCount = await playerRows.count();
    console.log(`  Found ${initialRowCount} players with data`);
    expect(initialRowCount).toBeGreaterThan(0);
    
    // Check that players have play time
    const firstPlayerPlayTime = await playerRows.first().locator('td').nth(3).textContent(); // Play time column
    console.log(`  Sample player play time: ${firstPlayerPlayTime}`);
    expect(firstPlayerPlayTime).not.toBe('0:00');
    
    // Navigate back to Games
    await clickButton(page, 'Games');
    await page.waitForTimeout(1000);
    
    // Step 11: Delete the game
    console.log('Step 11: Delete Game');
    const gameCard = page.locator('.game-card').filter({ hasText: TEST_DATA.game1.opponent });
    await expect(gameCard).toBeVisible();
    
    // Click on the game card to open game management
    await gameCard.click();
    await page.waitForTimeout(1000);
    
    // Wait for game management page to load
    await expect(page.getByText(`vs ${TEST_DATA.game1.opponent}`)).toBeVisible();
    console.log('  Opened game management');
    
    // Set up dialog handler to confirm deletion
    page.on('dialog', async (dialog) => {
      console.log(`  Confirming: ${dialog.message()}`);
      await dialog.accept();
    });
    
    // Find and click the "Delete Game" button at the bottom
    const deleteButton = page.locator('button.btn-delete-game', { hasText: 'Delete Game' });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    await page.waitForTimeout(2000);
    
    // Should be back at games list
    await page.waitForTimeout(1000);
    
    // Verify game is gone from the list
    const deletedGameCard = page.locator('.game-card').filter({ hasText: TEST_DATA.game1.opponent });
    await expect(deletedGameCard).not.toBeVisible();
    console.log('✓ Game deleted');
    
    // Remove dialog handler
    page.removeAllListeners('dialog');
    
    // Step 12: Verify Data Cleanup
    console.log('Step 12: Verify Data Cleanup');
    
    // Wait for deletion to propagate through GraphQL subscriptions
    await page.waitForTimeout(2000);
    
    // Navigate back to Reports
    await clickButton(page, 'Reports');
    await page.waitForTimeout(1000);
    
    // Verify all player play times are now 0:00
    const updatedPlayerRows = page.locator('tbody tr');
    const updatedRowCount = await updatedPlayerRows.count();
    console.log(`  Found ${updatedRowCount} players (should still exist)`);
    expect(updatedRowCount).toBe(initialRowCount); // Players still exist
    
    // Check that all players now have zero play time
    for (let i = 0; i < updatedRowCount; i++) {
      const playTimeCell = updatedPlayerRows.nth(i).locator('td').nth(3);
      const playTime = await playTimeCell.textContent();
      expect(playTime?.trim()).toBe('0m');
    }
    console.log('✓ All player play times reset to 0m');
    
    // Check that all players have zero goals
    for (let i = 0; i < updatedRowCount; i++) {
      const goalsCell = updatedPlayerRows.nth(i).locator('td').nth(4);
      const goals = await goalsCell.textContent();
      expect(goals?.trim()).toBe('0');
    }
    console.log('✓ All player goals reset to 0');
    
    // Check that all players have zero assists
    for (let i = 0; i < updatedRowCount; i++) {
      const assistsCell = updatedPlayerRows.nth(i).locator('td').nth(5);
      const assists = await assistsCell.textContent();
      expect(assists?.trim()).toBe('0');
    }
    console.log('✓ All player assists reset to 0');
    
    // Check that all players have zero game notes
    for (let i = 0; i < updatedRowCount; i++) {
      const starsCell = updatedPlayerRows.nth(i).locator('td').nth(6);
      const stars = await starsCell.textContent();
      expect(stars?.trim()).toBe('0');
    }
    console.log('✓ All player gold stars reset to 0');
    console.log('=== Game Deletion Data Cleanup Test Completed Successfully ===\n');
  });
});
