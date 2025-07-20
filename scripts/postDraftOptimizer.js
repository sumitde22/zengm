// Contract Dumper - Trade neutral/slightly positive contracts for prospects
// Run after draftTradeOptimizer to clean up accumulated contracts

// Helper: Get current game state
function getGameState() {
	return {
		userTid: bbgm.g.get("userTid"),
		season: bbgm.g.get("season"),
		draftYear: bbgm.g.get("season"),
	};
}

// Helper: Get all your players (excluding draft picks)
async function getCurrentPlayers() {
	const gameState = getGameState();
	const players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		gameState.userTid,
	);

	// Filter out players you drafted this year
	const nonDraftPlayers = players.filter(
		(p) =>
			!p.draft ||
			p.draft.year !== gameState.draftYear ||
			p.draft.originalTid !== gameState.userTid,
	);

	console.log(
		`📋 Found ${players.length} total players, ${nonDraftPlayers.length} non-draft players`,
	);
	return nonDraftPlayers;
}

// Helper: Check if player is untradable
function isUntradable(player) {
	const untradable = bbgm.trade.isUntradable(player);
	return untradable.untradable;
}

// Helper: Test if CPU would trade picks for this player
async function testCpuPickTrade(player) {
	// Get a random CPU team to test with
	const teams = await bbgm.idb.cache.teams.getAll();
	const cpuTeams = teams.filter(
		(t) => t.tid !== bbgm.g.get("userTid") && !t.disabled,
	);

	if (cpuTeams.length === 0) {
		return false;
	}

	const testTeam = cpuTeams[0]; // Use first available CPU team

	// Create a simple trade: player for a draft pick
	const trade = [
		{
			tid: bbgm.g.get("userTid"),
			pids: [player.pid],
			dpids: [],
		},
		{
			tid: testTeam.tid,
			pids: [],
			dpids: [], // We'll add a pick here
		},
	];

	// Get their draft picks
	const cpuPicks = await bbgm.idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		testTeam.tid,
	);

	if (cpuPicks.length === 0) {
		return false;
	}

	// Test with their worst pick
	const worstPick = cpuPicks.sort((a, b) =>
		a.round !== b.round ? b.round - a.round : b.pick - a.pick,
	)[0];

	trade[1].dpids = [worstPick.dpid];

	// Check if CPU would accept this trade
	try {
		const dv = await bbgm.team.valueChange(
			testTeam.tid,
			[],
			[player.pid],
			[],
			[worstPick.dpid],
			undefined,
			bbgm.g.get("userTid"),
		);

		// If dv > 0, CPU would accept (player is valuable)
		// If dv < 0, CPU would reject (player is not valuable enough)
		return dv > 0;
	} catch (error) {
		console.log(
			`Error testing trade for ${player.firstName} ${player.lastName}: ${error.message}`,
		);
		return false;
	}
}

// Main function to identify dumpable contracts
async function identifyDumpableContracts() {
	console.log("🔍 Identifying dumpable contracts...");
	console.log("=".repeat(50));

	const gameState = getGameState();
	console.log(`📊 Season: ${gameState.season}, Team: ${gameState.userTid}`);

	// Step 1: Get all non-draft players
	const players = await getCurrentPlayers();

	// Step 2: Filter out untradable players
	const tradablePlayers = players.filter((p) => !isUntradable(p));
	console.log(`✅ ${tradablePlayers.length} players are tradable`);

	// Step 3: Test which ones are high-value (CPU would trade picks for)
	console.log("\n🧪 Testing player values...");
	const highValuePlayers = [];
	const testablePlayers = [];

	for (const player of tradablePlayers) {
		console.log(
			`Testing ${player.firstName} ${player.lastName} (${player.ratings.pos})...`,
		);

		const isHighValue = await testCpuPickTrade(player);
		if (isHighValue) {
			highValuePlayers.push(player);
			console.log(`  ❌ HIGH VALUE - CPU would trade picks for this player`);
		} else {
			testablePlayers.push(player);
			console.log(`  ✅ Dumpable - CPU won't trade picks for this player`);
		}

		// Small delay to prevent overwhelming the system
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	// Step 4: Create final list of dumpable contracts
	console.log("\n📝 Final Results:");
	console.log(`High-value players (keep these): ${highValuePlayers.length}`);
	console.log(`Dumpable contracts: ${testablePlayers.length}`);

	console.log("\n🏆 Dumpable Contracts:");
	testablePlayers.forEach((player, index) => {
		console.log(
			`${index + 1}. ${player.firstName} ${player.lastName} (${player.ratings.pos})`,
		);
		console.log(
			`   Age: ${player.age}, Ovr: ${player.ratings.ovr}, Pot: ${player.ratings.pot}`,
		);
		console.log(
			`   Contract: $${(player.contract.amount * 1000).toLocaleString()} until ${player.contract.exp}`,
		);
		console.log(`   Value: ${player.value}`);
		console.log("");
	});

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

// Main function to find and execute prospect trades
async function findProspectTrades(dumpableContracts) {
	console.log("\n🎯 Finding prospect trades...");
	console.log("=".repeat(50));

	// Get all drafted players
	const draftedPlayers = await getDraftedPlayers();

	if (draftedPlayers.length === 0) {
		console.log("❌ No drafted players found");
		return [];
	}

	const successfulTrades = [];
	const attemptedTrades = [];

	// For each dumpable contract, find the best prospect trade
	for (const yourPlayer of dumpableContracts) {
		console.log(
			`\n🔍 Looking for trades for ${yourPlayer.firstName} ${yourPlayer.lastName}...`,
		);

		let bestTrade = null;
		let bestValue = -Infinity;

		// Test against all drafted players
		for (const prospect of draftedPlayers) {
			// Skip if prospect is already on your team
			if (prospect.tid === yourPlayer.tid) {
				continue;
			}

			const tradeResult = await testStraightUpTrade(yourPlayer, prospect);

			if (tradeResult.possible && tradeResult.valueChange > bestValue) {
				bestValue = tradeResult.valueChange;
				bestTrade = {
					yourPlayer,
					prospect,
					valueChange: tradeResult.valueChange,
				};
			}

			// Small delay to prevent overwhelming
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		if (bestTrade) {
			console.log(
				`🏆 Best trade found: ${bestTrade.prospect.firstName} ${bestTrade.prospect.lastName} (value change: ${bestTrade.valueChange.toFixed(2)})`,
			);

			// Execute the trade
			const success = await executeTrade(
				bestTrade.yourPlayer,
				bestTrade.prospect,
			);

			if (success) {
				successfulTrades.push(bestTrade);
				// Remove the prospect from the list since they're now on your team
				draftedPlayers.splice(draftedPlayers.indexOf(bestTrade.prospect), 1);
			}

			attemptedTrades.push(bestTrade);
		} else {
			console.log(
				`❌ No viable trades found for ${yourPlayer.firstName} ${yourPlayer.lastName}`,
			);
		}

		// Small delay between players
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	console.log(`\n📊 Prospect Trade Results:`);
	console.log(`Attempted trades: ${attemptedTrades.length}`);
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

// Helper: Check if player is protected from trading
function isProtected(player, gameState) {
	// Don't trade away players 22 or younger
	if (player.age <= PROSPECT_CONFIG.PROTECTION_RULES.MIN_AGE) {
		return true;
	}

	// Don't trade away your drafted players
	if (player.draft && player.draft.originalTid === gameState.userTid) {
		return true;
	}

	return false;
}

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
	const allPlayers = await bbgm.idb.cache.players.getAll();

	const prospects = {
		tier1: [], // Fresh draft picks
		tier2: [], // High potential non-draft picks
	};

	for (const player of allPlayers) {
		// Skip your own players
		if (player.tid === gameState.userTid) {
			continue;
		}

		// Skip protected players
		if (isProtected(player, gameState)) {
			continue;
		}

		// Tier 1: Fresh draft picks
		if (player.draft && player.draft.year === gameState.draftYear) {
			prospects.tier1.push(player);
			continue;
		}

		// Tier 2: High potential non-draft picks
		if (player.ratings.pot >= 50) {
			const salaryLimit = getSalaryLimit(player.ratings.pot);
			if (player.contract.amount * 1000 <= salaryLimit) {
				prospects.tier2.push(player);
			}
		}
	}

	console.log(
		`📋 Found ${prospects.tier1.length} Tier 1 prospects (fresh draft picks)`,
	);
	console.log(
		`📋 Found ${prospects.tier2.length} Tier 2 prospects (high potential)`,
	);

	return prospects;
}

// Helper: Find bad contracts on a team (prioritizing young players)
async function findBadContracts(teamTid) {
	const players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		teamTid,
	);

	const badContracts = [];

	for (const player of players) {
		// Skip protected players
		if (isProtected(player, getGameState())) {
			continue;
		}

		// Check if this player is negative value
		try {
			const dv = await bbgm.team.valueChange(
				teamTid,
				[],
				[player.pid],
				[],
				[],
				undefined,
				bbgm.g.get("userTid"),
			);

			// If dv > 0, team would pay to get rid of this player
			if (dv > 0) {
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
	return badContracts.sort((a, b) => {
		if (Math.abs(a.valueChange - b.valueChange) < 0.1) {
			// Similar value, prefer younger player
			return a.age - b.age;
		}
		return b.valueChange - a.valueChange;
	});
}

// Helper: Test trade for multiple prospects + bad contract
async function testProspectTrade(prospects, badContracts) {
	// Handle single bad contract case
	const badContractArray = Array.isArray(badContracts)
		? badContracts
		: [badContracts];

	// Create trade: you get multiple prospects + bad contracts for minimal return
	const trade = [
		{
			tid: bbgm.g.get("userTid"),
			pids: [],
			dpids: [],
		},
		{
			tid: prospects[0].tid, // All prospects should be from same team
			pids: [
				...prospects.map((p) => p.pid),
				...badContractArray.map((bc) => bc.player.pid),
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
			[
				...prospects.map((p) => p.pid),
				...badContractArray.map((bc) => bc.player.pid),
			],
			[],
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
async function executeProspectTrade(prospects, badContracts) {
	// Handle single bad contract case
	const badContractArray = Array.isArray(badContracts)
		? badContracts
		: [badContracts];

	console.log(`🔄 Executing prospect trade:`);
	console.log(`   Getting ${prospects.length} prospects:`);
	for (const prospect of prospects) {
		console.log(
			`      - ${prospect.firstName} ${prospect.lastName} (${prospect.ratings.pos}, Pot: ${prospect.ratings.pot})`,
		);
	}
	console.log(`   Taking ${badContractArray.length} bad contracts:`);
	for (const badContract of badContractArray) {
		console.log(
			`      - ${badContract.player.firstName} ${badContract.player.lastName} (Age: ${badContract.player.age}, Value: ${badContract.valueChange.toFixed(2)})`,
		);
	}

	try {
		await bbgm.trade.create([
			{
				tid: bbgm.g.get("userTid"),
				pids: [],
				dpids: [],
			},
			{
				tid: prospects[0].tid,
				pids: [
					...prospects.map((p) => p.pid),
					...badContractArray.map((bc) => bc.player.pid),
				],
				dpids: [],
			},
		]);

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

	const prospects = await getAllProspects();

	if (prospects.tier1.length === 0 && prospects.tier2.length === 0) {
		console.log("❌ No prospects found to acquire");
		return [];
	}

	const successfulTrades = [];
	const currentBadContracts = []; // Track bad contracts we've taken

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

	console.log(
		`\n📊 Teams sorted by rerouting potential (least negative contracts first):`,
	);
	teamsWithBadContracts.slice(0, 5).forEach((team, i) => {
		const teamName = bbgm.g.get("teamInfoCache")[team.teamTid]?.name;
		const totalProspects =
			team.teamProspects.tier1.length + team.teamProspects.tier2.length;
		console.log(
			`   ${i + 1}. ${teamName} (${totalProspects} prospects, least negative: ${team.leastNegativeContract.valueChange.toFixed(2)})`,
		);
	});

	// Process each team in order of their bad contracts
	for (const {
		teamTid,
		teamProspects,
		badContracts,
	} of teamsWithBadContracts) {
		const totalProspects =
			teamProspects.tier1.length + teamProspects.tier2.length;
		console.log(
			`\n🏢 Processing ${bbgm.g.get("teamInfoCache")[teamTid]?.name} (${totalProspects} prospects: ${teamProspects.tier1.length} Tier 1, ${teamProspects.tier2.length} Tier 2)...`,
		);

		console.log(`   📊 Bad contracts (already sorted by rerouting potential):`);
		badContracts.slice(0, 3).forEach((bc, i) => {
			console.log(
				`      ${i + 1}. ${bc.player.firstName} ${bc.player.lastName} (DV: ${bc.valueChange.toFixed(2)})`,
			);
		});

		// Calculate total negative DV the team wants to dump
		const totalNegativeDV = badContracts.reduce(
			(sum, bc) => sum + bc.valueChange,
			0,
		);
		console.log(
			`   💰 Total negative DV to dump: ${totalNegativeDV.toFixed(2)}`,
		);

		// Show our accumulated bad contracts if any
		if (currentBadContracts.length > 0) {
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

		// Sort by tier first, then by value within each tier
		const sortedProspects = prospectsWithValues.sort((a, b) => {
			if (a.tier !== b.tier) return a.tier - b.tier; // Tier 1 first
			return b.value - a.value; // Higher value first within tier
		});

		console.log(`   📊 Prospects by priority (Tier 1 first, then by value):`);
		sortedProspects.slice(0, 5).forEach((p, i) => {
			const tierLabel = p.tier === 1 ? "Tier 1" : "Tier 2";
			console.log(
				`      ${i + 1}. ${p.firstName} ${p.lastName} (${tierLabel}, Pot: ${p.ratings.pot}, Value: ${p.value.toFixed(1)})`,
			);
		});

		// Calculate the DV of taking prospects + their bad contracts
		console.log(`   🔄 Calculating DV of prospects + their bad contracts...`);
		const prospectsAndBadContractsDV = await bbgm.team.valueChange(
			bbgm.g.get("userTid"),
			[
				...sortedProspects.map((p) => p.pid),
				...badContracts.map((bc) => bc.player.pid),
			],
			[],
			[],
			[],
			undefined,
			teamTid,
		);
		console.log(
			`   📊 Taking prospects + their bad contracts = ${prospectsAndBadContractsDV.toFixed(2)} DV`,
		);

		// Only test combinations of our bad contracts that are less negative than that DV
		if (prospectsAndBadContractsDV > 0 && currentBadContracts.length > 0) {
			console.log(
				`   🔄 Testing our bad contract combinations (must be less than ${prospectsAndBadContractsDV.toFixed(2)} negative DV)...`,
			);

			let bestTrade = null;
			let maxNegativeDV = 0;

			// Sort our bad contracts by negative DV (most negative first)
			const sortedOurBadContracts = [...currentBadContracts].sort(
				(a, b) => a.valueChange - b.valueChange,
			);

			// Generate all valid combinations that meet the DV threshold
			const validCombinations = [];
			for (let i = 1; i <= sortedOurBadContracts.length; i++) {
				const combinations = getCombinations(sortedOurBadContracts, i);
				for (const combination of combinations) {
					const totalNegativeDV = Math.abs(
						combination.reduce((sum, bc) => sum + bc.valueChange, 0),
					);
					if (totalNegativeDV < prospectsAndBadContractsDV) {
						validCombinations.push({ combination, totalNegativeDV });
					}
				}
			}

			// Sort by negative DV (most negative first)
			validCombinations.sort((a, b) => b.totalNegativeDV - a.totalNegativeDV);

			console.log(
				`   📊 Found ${validCombinations.length} valid combinations to test...`,
			);

			// Test all valid combinations in optimal order
			for (const { combination, totalNegativeDV } of validCombinations) {
				console.log(
					`   🔄 Testing ${combination.length} contracts: ${combination.map((bc) => bc.valueChange.toFixed(1)).join(", ")} = ${totalNegativeDV.toFixed(1)} negative DV`,
				);

				const tradeResult = await testProspectTrade(
					sortedProspects,
					combination,
				);

				if (tradeResult.possible) {
					console.log(
						`   ✅ Trade possible! Dumping ${totalNegativeDV.toFixed(1)} negative DV`,
					);

					const success = await executeProspectTrade(
						sortedProspects,
						combination,
					);

					if (success) {
						bestTrade = {
							prospects: sortedProspects,
							badContracts: combination,
							valueChange: tradeResult.valueChange,
						};
						maxNegativeDV = totalNegativeDV;
						console.log(
							`   🎉 Trade successful! Dumping ${maxNegativeDV.toFixed(1)} negative DV`,
						);
						break; // Take the first successful trade (most negative contracts)
					}
				}

				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			if (bestTrade) {
				teamTrades.push(bestTrade);
				currentBadContracts.push(...bestTrade.badContracts);
				console.log(
					`   🏆 Best trade executed: Dumping ${maxNegativeDV.toFixed(1)} negative DV`,
				);
			} else {
				console.log(`   ❌ No viable combinations of our bad contracts found`);
			}
		} else {
			console.log(
				`   ❌ No positive DV from prospects + bad contracts, or no bad contracts to dump`,
			);
		}

		if (bestTrade) {
			teamTrades.push(bestTrade);
			currentBadContracts.push(...bestTrade.badContracts);
			console.log(
				`   🏆 Best trade executed: Dumping ${maxNegativeDV.toFixed(1)} negative DV`,
			);
		} else {
			// If still no trade, try removing worst prospects
			if (!foundTrade) {
				console.log(
					`   ❌ No trade possible with any bad contract combination, removing worst prospects...`,
				);

				let testProspects = [...sortedProspects];

				while (testProspects.length > 0) {
					testProspects.pop(); // Remove worst prospect

					if (testProspects.length === 0) {
						console.log(`   ❌ No viable trade possible with any prospects`);
						break;
					}

					console.log(
						`   🔄 Testing with ${testProspects.length} prospects (removed ${sortedProspects.length - testProspects.length} worst)...`,
					);

					// Try with all bad contracts first
					const tradeResult = await testProspectTrade(
						testProspects,
						badContracts,
					);

					if (tradeResult.possible) {
						console.log(
							`   ✅ Trade possible with ${testProspects.length} prospects!`,
						);

						const success = await executeProspectTrade(
							testProspects,
							badContracts,
						);

						if (success) {
							teamTrades.push({
								prospects: testProspects,
								badContracts,
								valueChange: tradeResult.valueChange,
							});
							currentBadContracts.push(...badContracts);
							console.log(`   🎉 Trade successful!`);
						}
						break;
					}

					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}
		}

		successfulTrades.push(...teamTrades);
		currentBadContracts.push(...teamTrades.map((t) => t.badContract));
		console.log(
			`   📊 Team complete: ${teamTrades.length} trades, ${teamTrades.reduce((sum, t) => sum + t.prospects.length, 0)} prospects acquired`,
		);
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

	// Step 1: Identify dumpable contracts
	const results = await identifyDumpableContracts();

	if (results.dumpable.length === 0) {
		console.log("❌ No dumpable contracts found");
		return;
	}

	// Step 2: Find and execute prospect trades
	const prospectTrades = await findProspectTrades(results.dumpable);

	// Step 3: Acquire prospects through bad contract chaining
	const chainingResults = await acquireProspectsThroughChaining();

	console.log(`\n🎉 Post-Draft Optimization Complete!`);
	console.log(`Dumpable contract trades: ${prospectTrades.length}`);
	console.log(`Prospect acquisition trades: ${chainingResults.trades.length}`);
	console.log(
		`Final bad contracts held: ${chainingResults.finalBadContracts.length}`,
	);

	return {
		dumpableContracts: results.dumpable.length,
		prospectTrades: prospectTrades.length,
		acquisitionTrades: chainingResults.trades.length,
		finalBadContracts: chainingResults.finalBadContracts.length,
		trades: [...prospectTrades, ...chainingResults.trades],
	};
}

// Export the main function
if (typeof module !== "undefined" && module.exports) {
	module.exports = { postDraftOptimize, identifyDumpableContracts };
} else {
	// Run in worker console
	postDraftOptimize().catch(console.error);
}
