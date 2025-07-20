// Contract Dumper - Trade neutral/slightly positive contracts for prospects
// Run after draftTradeOptimizer to clean up accumulated contracts

// Helper: Get current game state
function getGameState() {
	const userTid = bbgm.g.get("userTid");
	const season = bbgm.g.get("season");
	const draftYear = bbgm.g.get("season");

	return {
		userTid: userTid,
		season: season,
		draftYear: draftYear,
	};
}

// Helper: Get all your players (excluding draft picks)
async function getCurrentPlayers() {
	const gameState = getGameState();
	const players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		gameState.userTid,
	);
	return players;
}

// Helper: Get contending teams (teams with strategy === "contending")
async function getContendingTeams() {
	const userTid = bbgm.g.get("userTid");
	const teams = await bbgm.idb.cache.teams.getAll();
	return teams.filter(
		(t) => t.tid !== userTid && !t.disabled && t.strategy === "contending",
	);
}

// Helper: Get worst pick from each team using valueChange to determine actual value
async function getTeamsWorstPicks() {
	const userTid = bbgm.g.get("userTid");
	const allTeams = await bbgm.idb.cache.teams.getAll();
	const cpuTeams = allTeams.filter((t) => t.tid !== userTid && !t.disabled);

	// Try contending teams first
	const contendingTeams = cpuTeams.filter((t) => t.strategy === "contending");
	let teamsToTest = contendingTeams;
	let teamType = "contending";

	// Fallback to all CPU teams if no contending teams
	if (contendingTeams.length === 0) {
		teamsToTest = cpuTeams;
		teamType = "all CPU";
	}

	const worstPicks = [];

	for (const team of teamsToTest) {
		const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		if (picks.length > 0) {
			// Find worst pick by testing each pick's value directly
			let worstPick = picks[0];
			let worstValue = -Infinity; // Start with most negative possible

			for (const pick of picks) {
				try {
					const dv = await bbgm.team.valueChange(
						team.tid,
						[],
						[],
						[],
						[pick.dpid],
						undefined,
						userTid,
					);

					// Look for the pick with value closest to 0 (least valuable pick)
					if (dv > worstValue) {
						worstValue = dv;
						worstPick = pick;
					}
				} catch (error) {
					// Skip if error
				}
			}

			worstPicks.push({ ...worstPick, tid: team.tid, value: worstValue });
		}
	}

	// Sort by actual value (closest to 0 first = worst picks)
	const sortedPicks = worstPicks.sort((a, b) => b.value - a.value);

	return { picks: sortedPicks, teamType, teamCount: teamsToTest.length };
}

// Helper: Test if CPU would trade their worst pick for this player
async function testCpuPickTrade(player, worstPick) {
	if (!worstPick) return false;
	const cpuTid = worstPick.tid;
	try {
		const dv = await bbgm.team.valueChange(
			cpuTid,
			[player.pid], // CPU gets the player
			[], // CPU gives no players
			[], // CPU gets no picks
			[worstPick.dpid], // CPU gives the pick
			undefined,
			bbgm.g.get("userTid"),
		);
		return dv > 0;
	} catch (error) {
		return false;
	}
}

// Main function to identify dumpable contracts
async function identifyDumpableContracts() {
	console.log("🔍 Identifying dumpable contracts...");
	console.log("=".repeat(50));

	const gameState = getGameState();
	console.log(`📊 Season: ${gameState.season}, Team: ${gameState.userTid}`);

	// Step 1: Get all your players
	const players = await getCurrentPlayers();

	// Step 2: Filter out untradable players and protected players
	const tradablePlayers = players.filter((p) => {
		// Calculate age consistently
		const playerAge =
			p.age !== undefined
				? p.age
				: p.born && p.born.year
					? gameState.season - p.born.year
					: 0;

		return (
			!bbgm.trade.isUntradable(p).untradable &&
			// Age protection: never trade away players 22 or younger
			!(playerAge <= 22) &&
			// Sentimental protection: never trade away any player drafted by your team
			!(p.draft && p.draft.originalTid === gameState.userTid) &&
			// Extra protection: never trade away any player drafted in the current season (just-drafted)
			!(p.draft && p.draft.year === gameState.season)
		);
	});
	console.log(`✅ ${tradablePlayers.length} players are tradable`);

	// Step 3: Get worst picks from teams (contending teams first, fallback to all teams)
	const worstPicksResult = await getTeamsWorstPicks();
	const worstPicks = worstPicksResult.picks;

	if (worstPicks.length === 0) {
		console.log("❌ No CPU picks found to test against");
		return {
			dumpable: [],
			highValue: [],
			total: players.length,
			tradable: tradablePlayers.length,
		};
	}

	console.log(
		`🎯 Testing against ${worstPicks.length} worst picks from ${worstPicksResult.teamCount} ${worstPicksResult.teamType} teams`,
	);

	// Step 4: Test which ones are high-value (CPU would trade any worst pick for)
	const highValuePlayers = [];
	const testablePlayers = [];

	for (const player of tradablePlayers) {
		let isHighValue = false;

		// Test against each team's worst pick with early exit
		for (const worstPick of worstPicks) {
			const wouldTrade = await testCpuPickTrade(player, worstPick);
			if (wouldTrade) {
				isHighValue = true;
				break; // Early exit - found a team that would trade
			}
			await new Promise((resolve) => setTimeout(resolve, 25)); // Shorter delay since we're testing multiple teams
		}

		if (isHighValue) {
			highValuePlayers.push(player);
		} else {
			testablePlayers.push(player);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	// Step 5: Create final list of dumpable contracts
	console.log("\n📝 Final Results:");
	console.log(`High-value players (keep these): ${highValuePlayers.length}`);
	console.log(`Dumpable contracts: ${testablePlayers.length}`);

	return {
		dumpable: testablePlayers,
		highValue: highValuePlayers,
		total: players.length,
		tradable: tradablePlayers.length,
	};
}

// Helper: Get all players drafted this year
async function getDraftedPlayers() {
	const gameState = getGameState();
	const allPlayers = await bbgm.idb.cache.players.getAll();

	// Filter for players drafted this year
	const draftedPlayers = allPlayers.filter(
		(p) => p.draft && p.draft.year === gameState.draftYear,
	);

	console.log(
		`📋 Found ${draftedPlayers.length} players drafted in ${gameState.draftYear}`,
	);
	return draftedPlayers;
}

// Helper: Test straight-up trade (your contract for their prospect)
async function testStraightUpTrade(yourPlayer, theirProspect) {
	// Skip if trying to trade with yourself
	if (yourPlayer.tid === theirProspect.tid) {
		return { possible: false, reason: "Same team" };
	}

	// Create trade structure
	const trade = [
		{
			tid: yourPlayer.tid,
			pids: [yourPlayer.pid],
			dpids: [],
		},
		{
			tid: theirProspect.tid,
			pids: [theirProspect.pid],
			dpids: [],
		},
	];

	// Check financial constraints first
	try {
		const summary = await bbgm.trade.summary(trade);
		if (summary.warning) {
			// Check if the warning is about salary cap issues
			if (
				summary.warning.includes("salary cap") ||
				summary.warning.includes("cap")
			) {
				return { possible: false, reason: "Salary cap violation" };
			}
			// Other warnings might be okay, continue with value check
		}
	} catch (error) {
		return {
			possible: false,
			reason: `Trade validation error: ${error.message}`,
		};
	}

	// Check if CPU would accept this trade
	try {
		const dv = await bbgm.team.valueChange(
			theirProspect.tid,
			[yourPlayer.pid],
			[theirProspect.pid],
			[],
			[],
			undefined,
			yourPlayer.tid,
		);

		// If dv > 0, CPU would accept
		return {
			possible: dv > 0,
			valueChange: dv,
			reason: dv > 0 ? "CPU accepts" : "CPU rejects",
		};
	} catch (error) {
		return { possible: false, reason: `Error: ${error.message}` };
	}
}

// Helper: Execute a trade
async function executeTrade(yourPlayer, theirProspect) {
	console.log(
		`🔄 Executing trade: ${yourPlayer.firstName} ${yourPlayer.lastName} for ${theirProspect.firstName} ${theirProspect.lastName}`,
	);

	try {
		// Create the trade
		await bbgm.trade.create([
			{
				tid: yourPlayer.tid,
				pids: [yourPlayer.pid],
				dpids: [],
			},
			{
				tid: theirProspect.tid,
				pids: [theirProspect.pid],
				dpids: [],
			},
		]);

		// Propose the trade
		const [success, message] = await bbgm.trade.propose(false);

		if (success) {
			console.log(`✅ Trade successful: ${message}`);
			return true;
		} else {
			console.log(`❌ Trade failed: ${message}`);
			return false;
		}
	} catch (error) {
		console.log(`❌ Error executing trade: ${error.message}`);
		return false;
	}
}

// Update findProspectTrades to re-run identifyDumpableContracts after every successful trade
async function findProspectTrades(initialDumpableContracts) {
	console.log("\n🎯 Finding prospect trades...");
	console.log("=".repeat(50));

	let dumpableContracts = initialDumpableContracts;
	const successfulTrades = [];
	const attemptedTrades = [];

	// Get all drafted players
	const draftedPlayers = await getDraftedPlayers();
	console.log(
		`📋 Found ${draftedPlayers.length} players drafted in ${bbgm.g.get("season")}`,
	);
	if (draftedPlayers.length === 0) {
		console.log("❌ No drafted players found");
		return [];
	}

	while (dumpableContracts.length > 0) {
		let tradeMade = false;
		for (const yourPlayer of dumpableContracts) {
			let bestTrade = null;
			let bestValue = -Infinity;

			// Test against all drafted players
			let testedCount = 0;
			for (const prospect of draftedPlayers) {
				if (prospect.tid === yourPlayer.tid) continue;
				testedCount++;
				const tradeResult = await testStraightUpTrade(yourPlayer, prospect);
				if (tradeResult.possible && tradeResult.valueChange > bestValue) {
					bestValue = tradeResult.valueChange;
					bestTrade = {
						yourPlayer,
						prospect,
						valueChange: tradeResult.valueChange,
					};
					console.log(
						`   ✅ Found trade: ${yourPlayer.firstName} ${yourPlayer.lastName} for ${prospect.firstName} ${prospect.lastName} (value: ${tradeResult.valueChange.toFixed(2)})`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (testedCount > 0 && !bestTrade) {
				console.log(
					`   ❌ No trades found for ${yourPlayer.firstName} ${yourPlayer.lastName} (tested ${testedCount} prospects)`,
				);
			}

			if (bestTrade) {
				const success = await executeTrade(
					bestTrade.yourPlayer,
					bestTrade.prospect,
				);
				if (success) {
					successfulTrades.push(bestTrade);
					// Remove the prospect from the list since they're now on your team
					draftedPlayers.splice(draftedPlayers.indexOf(bestTrade.prospect), 1);
					tradeMade = true;
					break; // After a trade, re-evaluate dumpable contracts
				}
				attemptedTrades.push(bestTrade);
			}
		}
		if (tradeMade) {
			// Re-run identifyDumpableContracts to update dumpableContracts
			const dumpResult = await identifyDumpableContracts();
			dumpableContracts = dumpResult.dumpable;
		} else {
			break; // No more trades possible
		}
	}

	console.log(`\n📊 Prospect Trade Results:`);
	console.log(`Successful trades: ${successfulTrades.length}`);

	return successfulTrades;
}

// Configuration for prospect acquisition
const PROSPECT_CONFIG = {
	// Salary limits by potential rating
	SALARY_LIMITS: {
		50: 1000000, // 50-52 potential: max $1M
		53: 2000000, // 53-54 potential: max $2M
		55: 5000000, // 55-57 potential: max $5M
		58: Infinity, // 58+ potential: any salary
	},

	// Protection rules
	PROTECTION_RULES: {
		MIN_AGE: 23, // Don't trade away players 22 or younger
	},
};

// Helper: Get salary limit for potential rating
function getSalaryLimit(potential) {
	for (let pot = 58; pot >= 50; pot -= 2) {
		if (potential >= pot) {
			return PROSPECT_CONFIG.SALARY_LIMITS[pot];
		}
	}
	return 0; // Below 50 potential
}

// Helper: Get all prospects in the league (Tier 1: fresh draft picks, Tier 2: high potential)
async function getAllProspects() {
	const gameState = getGameState();
	const teams = await bbgm.idb.cache.teams.getAll();
	const otherTeams = teams.filter(
		(t) => t.tid !== gameState.userTid && !t.disabled,
	);

	const prospects = {
		tier1: [], // Fresh draft picks
		tier2: [], // High potential non-draft picks
	};

	for (const team of otherTeams) {
		let teamPlayers;
		try {
			teamPlayers = await Promise.race([
				bbgm.idb.cache.players.indexGetAll("playersByTid", team.tid),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Timeout")), 2000),
				),
			]);
		} catch (err) {
			continue;
		}
		for (const player of teamPlayers) {
			if (player.draft && player.draft.year === gameState.draftYear) {
				prospects.tier1.push(player);
				continue;
			}
			if (player.ratings.pot >= 50) {
				const salaryLimit = getSalaryLimit(player.ratings.pot);
				if (player.contract.amount * 1000 <= salaryLimit) {
					prospects.tier2.push(player);
				}
			}
		}
	}
	return prospects;
}

// Helper: Find bad contracts on a team (prioritizing young players)
async function findBadContracts(teamTid) {
	const players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		teamTid,
	);

	// Get prospects for this team to exclude them from bad contracts
	const prospects = await getAllProspects();
	const allProspects = [...prospects.tier1, ...prospects.tier2];
	const prospectPids = new Set(allProspects.map((p) => p.pid));

	const badContracts = [];

	for (const player of players) {
		// Skip protected players
		if (player.draft && player.draft.originalTid === bbgm.g.get("userTid")) {
			continue;
		}

		// Skip prospects - they can't be bad contracts
		if (prospectPids.has(player.pid)) {
			continue;
		}

		// Additional safety check: skip any player who could be considered a prospect
		// (just-drafted players, high potential players, etc.)
		if (player.draft && player.draft.year === bbgm.g.get("season")) {
			continue; // Just-drafted players are prospects
		}

		// Check if this player is a bad contract (team would accept getting rid of them for minimal return)
		try {
			// Test if team would accept getting rid of this player for a very late pick
			const dv = await bbgm.team.valueChange(
				teamTid,
				[], // CPU gets nothing
				[player.pid], // CPU gives away the player
				[], // CPU gets no picks
				[], // CPU gives no picks
				undefined,
				bbgm.g.get("userTid"),
			);

			// Debug for specific teams
			if (teamTid === 15 || teamTid === 25) {
				console.log(
					`     ${player.firstName} ${player.lastName}: DV = ${dv.toFixed(2)}`,
				);
			}

			// If dv >= 0, team would accept getting rid of this player (bad or neutral contract)
			// The more positive, the worse the contract
			if (dv >= 0) {
				badContracts.push({
					player,
					valueChange: dv,
					age: player.age,
				});
			}
		} catch (error) {
			// Skip if error
		}
	}

	// Sort by value change (highest first), then by age (younger first for tiebreakers)
	const sortedBadContracts = badContracts.sort((a, b) => {
		if (Math.abs(a.valueChange - b.valueChange) < 0.1) {
			// Similar value, prefer younger player
			return a.age - b.age;
		}
		return b.valueChange - a.valueChange;
	});

	// Debug: verify no overlap between prospects and bad contracts
	if (teamTid === 15 || teamTid === 25) {
		const badContractPids = new Set(
			sortedBadContracts.map((bc) => bc.player.pid),
		);
		const overlap = allProspects.filter((p) => badContractPids.has(p.pid));
		if (overlap.length > 0) {
			console.log(
				`   ⚠️  WARNING: Found ${overlap.length} players in both prospects and bad contracts: ${overlap.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}`,
			);
		} else {
			console.log(`   ✅ No overlap between prospects and bad contracts`);
		}
	}

	return sortedBadContracts;
}

// Helper: Test trade for multiple prospects + bad contract
async function testProspectTrade(
	prospects,
	ourBadContracts,
	theirBadContracts,
) {
	// Handle single bad contract case
	const ourBadContractArray = Array.isArray(ourBadContracts)
		? ourBadContracts
		: [ourBadContracts];
	const theirBadContractArray = Array.isArray(theirBadContracts)
		? theirBadContracts
		: [theirBadContracts];

	// Create trade: we get prospects + their bad contracts for our bad contracts (if any)
	const trade = [
		{
			tid: bbgm.g.get("userTid"),
			pids: ourBadContractArray.map((bc) => bc.player.pid),
			dpids: [],
		},
		{
			tid: prospects[0].tid, // All prospects should be from same team
			pids: [
				...prospects.map((p) => p.pid),
				...theirBadContractArray.map((bc) => bc.player.pid),
			],
			dpids: [],
		},
	];

	// Check financial constraints
	try {
		const summary = await bbgm.trade.summary(trade);
		if (
			summary.warning &&
			(summary.warning.includes("salary cap") ||
				summary.warning.includes("cap"))
		) {
			return { possible: false, reason: "Salary cap violation" };
		}
	} catch (error) {
		return {
			possible: false,
			reason: `Trade validation error: ${error.message}`,
		};
	}

	// Check if CPU would accept
	try {
		const dv = await bbgm.team.valueChange(
			prospects[0].tid,
			ourBadContractArray.map((bc) => bc.player.pid), // CPU gets our bad contracts
			[
				...prospects.map((p) => p.pid),
				...theirBadContractArray.map((bc) => bc.player.pid),
			], // CPU gives prospects + their bad contracts
			[],
			[],
			undefined,
			bbgm.g.get("userTid"),
		);

		return {
			possible: dv > 0,
			valueChange: dv,
			reason: dv > 0 ? "CPU accepts" : "CPU rejects",
		};
	} catch (error) {
		return { possible: false, reason: `Error: ${error.message}` };
	}
}

// Helper: Execute prospect trade
async function executeProspectTrade(
	prospects,
	ourBadContracts,
	theirBadContracts,
) {
	// Handle single bad contract case
	const ourBadContractArray = Array.isArray(ourBadContracts)
		? ourBadContracts
		: [ourBadContracts];
	const theirBadContractArray = Array.isArray(theirBadContracts)
		? theirBadContracts
		: [theirBadContracts];

	try {
		await bbgm.trade.create([
			{
				tid: bbgm.g.get("userTid"),
				pids: ourBadContractArray.map((bc) => bc.player.pid),
				dpids: [],
			},
			{
				tid: prospects[0].tid,
				pids: [
					...prospects.map((p) => p.pid),
					...theirBadContractArray.map((bc) => bc.player.pid),
				],
				dpids: [],
			},
		]);

		const [success, message] = await bbgm.trade.propose(false);

		if (success) {
			return true;
		} else {
			return false;
		}
	} catch (error) {
		console.log(`❌ Error executing trade: ${error.message}`);
		return false;
	}
}

// Helper: Get prospect value using game's value system
async function getProspectValue(prospect) {
	// Use the game's built-in value system
	await bbgm.player.updateValues(prospect);
	return prospect.value;
}

// Helper: Generate all combinations of size k from array
function getCombinations(array, k) {
	if (k === 1) {
		return array.map((item) => [item]);
	}

	const combinations = [];
	for (let i = 0; i <= array.length - k; i++) {
		const head = array[i];
		const tailCombinations = getCombinations(array.slice(i + 1), k - 1);
		for (const tailCombination of tailCombinations) {
			combinations.push([head, ...tailCombination]);
		}
	}
	return combinations;
}

// Main function to acquire prospects through bad contract chaining
async function acquireProspectsThroughChaining() {
	console.log(
		"\n🎯 Starting Prospect Acquisition Through Bad Contract Chaining...",
	);
	console.log("=".repeat(60));

	console.log("🔍 Getting all prospects...");
	const prospects = await getAllProspects();
	console.log(
		`✅ Got prospects: Tier 1 (${prospects.tier1.length}), Tier 2 (${prospects.tier2.length})`,
	);

	if (prospects.tier1.length === 0 && prospects.tier2.length === 0) {
		console.log("❌ No prospects found to acquire");
		return { trades: [], finalBadContracts: [] };
	}

	const successfulTrades = [];
	const currentBadContracts = []; // Track bad contracts we've taken

	console.log("🔍 Grouping prospects by team...");
	// Group ALL prospects by team and get bad contracts in one pass
	const allProspects = [...prospects.tier1, ...prospects.tier2];
	const teamsWithBadContracts = [];

	for (const prospect of allProspects) {
		const teamTid = prospect.tid;

		// Find or create team entry
		let teamEntry = teamsWithBadContracts.find((t) => t.teamTid === teamTid);
		if (!teamEntry) {
			// Get bad contracts for this team
			const badContracts = await findBadContracts(teamTid);
			if (badContracts.length > 0) {
				// Sort bad contracts by value (closest to 0 first)
				badContracts.sort(
					(a, b) => Math.abs(a.valueChange) - Math.abs(b.valueChange),
				);
				teamEntry = {
					teamTid,
					teamProspects: { tier1: [], tier2: [] },
					badContracts,
					leastNegativeContract: badContracts[0], // First one after sorting
				};
				teamsWithBadContracts.push(teamEntry);
			}
		}

		// Add prospect to team if team has bad contracts
		if (teamEntry) {
			// Categorize prospect
			if (prospect.draft && prospect.draft.year === bbgm.g.get("season")) {
				teamEntry.teamProspects.tier1.push(prospect);
			} else {
				teamEntry.teamProspects.tier2.push(prospect);
			}
		}
	}

	// Sort teams by their least negative contract (closest to 0 first)
	teamsWithBadContracts.sort(
		(a, b) =>
			Math.abs(a.leastNegativeContract.valueChange) -
			Math.abs(b.leastNegativeContract.valueChange),
	);

	// Process each team in order of their bad contracts
	for (const {
		teamTid,
		teamProspects,
		badContracts,
	} of teamsWithBadContracts) {
		// Debug specific teams
		const teamNames = { 15: "NYC", 25: "TPA" };
		const isDebugTeam = teamTid === 15 || teamTid === 25;

		if (isDebugTeam) {
			console.log(
				`\n🔍 DEBUG: Processing team ${teamNames[teamTid]} (TID: ${teamTid})`,
			);
			console.log(
				`   Prospects: Tier 1 (${teamProspects.tier1.length}), Tier 2 (${teamProspects.tier2.length})`,
			);
			console.log(`   Bad contracts: ${badContracts.length}`);
			badContracts.forEach((bc, i) => {
				console.log(
					`     ${i + 1}. ${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`,
				);
			});
		}

		// Show our accumulated bad contracts if any (only once per team)
		if (currentBadContracts.length > 0 && isDebugTeam) {
			console.log(
				`   📦 Our accumulated bad contracts (${currentBadContracts.length}):`,
			);
			currentBadContracts.forEach((bc, i) => {
				console.log(
					`      ${i + 1}. ${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`,
				);
			});
		}

		// Sort prospects by tier and value (Tier 1 first, then by value within each tier)
		const prospectsWithValues = [];

		// Process Tier 1 prospects first
		for (const prospect of teamProspects.tier1) {
			const value = await getProspectValue(prospect);
			prospectsWithValues.push({ ...prospect, value, tier: 1 });
		}

		// Then process Tier 2 prospects
		for (const prospect of teamProspects.tier2) {
			const value = await getProspectValue(prospect);
			prospectsWithValues.push({ ...prospect, value, tier: 2 });
		}

		if (isDebugTeam) {
			console.log(
				`   Processing prospects: ${prospectsWithValues.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}`,
			);
		}

		// Sort by tier first, then by value within each tier
		const sortedProspects = prospectsWithValues.sort((a, b) => {
			if (a.tier !== b.tier) return a.tier - b.tier; // Tier 1 first
			return b.value - a.value; // Higher value first within tier
		});

		let bestTrade = null;

		// Try to find a trade using our bad contracts + their bad contracts
		if (currentBadContracts.length > 0) {
			// Sort our bad contracts by negative DV (most negative first)
			const sortedOurBadContracts = [...currentBadContracts].sort(
				(a, b) => a.valueChange - b.valueChange,
			);

			// Try different combinations of our bad contracts, starting with smaller combinations
			// and working up to larger ones to find the most efficient trade
			// Prioritize trades that require fewer of our bad contracts
			for (let i = 1; i <= Math.min(sortedOurBadContracts.length, 2); i++) {
				const combinations = getCombinations(sortedOurBadContracts, i);

				// Sort combinations by total negative DV (most negative first)
				const sortedCombinations = combinations
					.map((combination) => ({
						combination,
						totalNegativeDV: Math.abs(
							combination.reduce((sum, bc) => sum + bc.valueChange, 0),
						),
					}))
					.sort((a, b) => b.totalNegativeDV - a.totalNegativeDV);

				// Test each combination
				for (const { combination, totalNegativeDV } of sortedCombinations) {
					// Debug specific teams
					if (isDebugTeam) {
						console.log(
							`   Testing combination: ${combination.length} our bad contracts (total DV: ${totalNegativeDV.toFixed(2)})`,
						);
						combination.forEach((bc, i) => {
							console.log(
								`     ${i + 1}. ${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`,
							);
						});
					}

					// Try different combinations of their bad contracts, starting with the fewest needed
					for (let j = 1; j <= Math.min(badContracts.length, 2); j++) {
						const theirBadContractCombinations = getCombinations(
							badContracts,
							j,
						);

						// Sort by total negative value (least negative first - take the least bad contracts overall)
						const sortedTheirCombinations = theirBadContractCombinations
							.map((combo) => ({
								combination: combo,
								totalDV: combo.reduce((sum, bc) => sum + bc.valueChange, 0),
							}))
							.sort((a, b) => a.totalDV - b.totalDV); // Least negative first

						for (const {
							combination: theirBadContractCombo,
						} of sortedTheirCombinations) {
							if (isDebugTeam) {
								console.log(
									`     Testing with ${theirBadContractCombo.length} their bad contracts: ${theirBadContractCombo.map((bc) => `${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`).join(", ")}`,
								);
							}

							const tradeResult = await testProspectTrade(
								sortedProspects,
								combination,
								theirBadContractCombo,
							);

							if (isDebugTeam) {
								console.log(
									`     Trade result: ${tradeResult.possible ? "SUCCESS" : "FAILED"} (${tradeResult.reason})`,
								);
							}

							if (tradeResult.possible) {
								const success = await executeProspectTrade(
									sortedProspects,
									combination,
									theirBadContractCombo,
								);

								if (success) {
									bestTrade = {
										prospects: sortedProspects,
										badContracts: combination,
										theirBadContracts: theirBadContractCombo,
										valueChange: tradeResult.valueChange,
									};
									console.log(
										`     🎯 FOUND OPTIMAL TRADE: ${theirBadContractCombo.length} bad contracts needed`,
									);
									break; // Take the first successful trade (most optimal)
								}
							}

							await new Promise((resolve) => setTimeout(resolve, 50));
						}

						if (bestTrade) {
							console.log(
								`     ✅ Stopping at ${j} bad contracts - found optimal trade`,
							);
							break;
						}
					}

					if (bestTrade) break;
				}

				// If we found a successful trade, no need to try larger combinations
				if (bestTrade) {
					break;
				}
			}
		}

		// If no trade with our bad contracts, try with just their bad contracts
		if (!bestTrade) {
			// Try different combinations of their bad contracts, starting with the fewest needed
			for (let j = 1; j <= Math.min(badContracts.length, 2); j++) {
				const theirBadContractCombinations = getCombinations(badContracts, j);

				// Sort by total negative value (least negative first - take the least bad contracts overall)
				const sortedTheirCombinations = theirBadContractCombinations
					.map((combo) => ({
						combination: combo,
						totalDV: combo.reduce((sum, bc) => sum + bc.valueChange, 0),
					}))
					.sort((a, b) => a.totalDV - b.totalDV); // Least negative first

				for (const {
					combination: theirBadContractCombo,
				} of sortedTheirCombinations) {
					if (isDebugTeam) {
						console.log(
							`   Testing with ${theirBadContractCombo.length} their bad contracts (no ours): ${theirBadContractCombo.map((bc) => `${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`).join(", ")}`,
						);
					}

					const tradeResult = await testProspectTrade(
						sortedProspects,
						[], // No bad contracts from us
						theirBadContractCombo,
					);

					if (isDebugTeam) {
						console.log(
							`   Trade result: ${tradeResult.possible ? "SUCCESS" : "FAILED"} (${tradeResult.reason})`,
						);
					}

					if (tradeResult.possible) {
						const success = await executeProspectTrade(
							sortedProspects,
							[], // No bad contracts from us
							theirBadContractCombo,
						);

						if (success) {
							bestTrade = {
								prospects: sortedProspects,
								badContracts: [], // No bad contracts from us
								theirBadContracts: theirBadContractCombo,
								valueChange: tradeResult.valueChange,
							};
							console.log(
								`   🎯 FOUND OPTIMAL TRADE (no ours): ${theirBadContractCombo.length} bad contracts needed`,
							);
							break;
						}
					}

					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				if (bestTrade) {
					console.log(
						`   ✅ Stopping at ${j} bad contracts - found optimal trade (no ours)`,
					);
					break;
				}
			}
		}

		// If still no trade, try removing worst prospects
		if (!bestTrade) {
			let testProspects = [...sortedProspects];

			while (testProspects.length > 0) {
				testProspects.pop(); // Remove worst prospect

				if (testProspects.length === 0) {
					break;
				}

				const tradeResult = await testProspectTrade(
					testProspects,
					[], // No bad contracts from us
					badContracts,
				);

				if (tradeResult.possible) {
					const success = await executeProspectTrade(
						testProspects,
						[], // No bad contracts from us
						badContracts,
					);

					if (success) {
						bestTrade = {
							prospects: testProspects,
							badContracts: [], // No bad contracts from us
							theirBadContracts: badContracts,
							valueChange: tradeResult.valueChange,
						};
					}
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}

		// Add successful trade to results
		if (bestTrade) {
			console.log(
				`   ✅ SUCCESS: Trade found for ${teamNames[teamTid] || `team ${teamTid}`}`,
			);
			console.log(
				`      Prospects: ${bestTrade.prospects.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}`,
			);
			console.log(
				`      Our bad contracts given: ${bestTrade.badContracts.map((bc) => `${bc.player.firstName} ${bc.player.lastName}`).join(", ")}`,
			);
			console.log(
				`      Their bad contracts taken: ${bestTrade.theirBadContracts.map((bc) => `${bc.player.firstName} ${bc.player.lastName}`).join(", ")}`,
			);
			successfulTrades.push(bestTrade);
			currentBadContracts.push(...bestTrade.theirBadContracts);

			// Remove traded prospects from all teams to prevent duplication
			const tradedProspectPids = bestTrade.prospects.map((p) => p.pid);
			for (const team of teamsWithBadContracts) {
				team.teamProspects.tier1 = team.teamProspects.tier1.filter(
					(p) => !tradedProspectPids.includes(p.pid),
				);
				team.teamProspects.tier2 = team.teamProspects.tier2.filter(
					(p) => !tradedProspectPids.includes(p.pid),
				);
			}
		}
	}

	console.log(`\n📊 Prospect Acquisition Results:`);
	console.log(`Successful trades: ${successfulTrades.length}`);
	console.log(
		`Total prospects acquired: ${successfulTrades.reduce((sum, trade) => sum + trade.prospects.length, 0)}`,
	);
	console.log(`Final bad contracts held: ${currentBadContracts.length}`);

	return {
		trades: successfulTrades,
		finalBadContracts: currentBadContracts,
	};
}

// Main optimization function
async function postDraftOptimize() {
	console.log("🚀 Starting Post-Draft Optimization...");
	console.log("=".repeat(50));

	// Track recently acquired prospects to protect them
	const recentlyAcquiredProspects = new Set();

	// Phase 1: Dump bad/neutral contracts for anything
	const dumpResult = await identifyDumpableContracts();
	console.log(
		`\nPhase 1: Dumpable contracts found: ${dumpResult.dumpable.length}`,
	);
	// After printing the number of dumpable contracts, print only name, age, ovr, pot for each
	const season = bbgm.g.get("season");
	if (dumpResult.dumpable.length > 0) {
		// Sort dumpable players by age (oldest first)
		const sortedDumpable = [...dumpResult.dumpable].sort((a, b) => {
			const ageA =
				a.age !== undefined
					? a.age
					: a.born && a.born.year
						? season - a.born.year
						: 0;
			const ageB =
				b.age !== undefined
					? b.age
					: b.born && b.born.year
						? season - b.born.year
						: 0;
			return ageB - ageA; // Oldest first
		});

		console.log("Dumpable contracts (sorted by age, oldest first):");
		sortedDumpable.forEach((p, i) => {
			const latestRatings = p.ratings?.[p.ratings.length - 1] || {};
			const ovr = latestRatings.ovr !== undefined ? latestRatings.ovr : "N/A";
			const pot = latestRatings.pot !== undefined ? latestRatings.pot : "N/A";
			const age =
				p.age !== undefined
					? p.age
					: p.born && p.born.year
						? season - p.born.year
						: "N/A";
			console.log(
				`${i + 1}. ${p.firstName} ${p.lastName} | Age: ${age}, Ovr: ${ovr}, Pot: ${pot}`,
			);
		});
	} else {
		console.log("No dumpable contracts found.");
	}

	const prospectTrades = await findProspectTrades(dumpResult.dumpable);
	console.log(`Prospect trades completed: ${prospectTrades.length}`);

	// Phase 2: Use cap space/bad contracts to acquire prospects via chaining
	const chainingResults = await acquireProspectsThroughChaining();
	console.log(`\nPhase 2: Chaining prospect acquisition complete!`);
	console.log(`Chaining trades: ${chainingResults.trades.length}`);
	console.log(
		`Final bad contracts held: ${chainingResults.finalBadContracts.length}`,
	);
}

await postDraftOptimize();
