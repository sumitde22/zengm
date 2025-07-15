async function findMostValuablePicks() {
	const userTid = bbgm.g.get("userTid");
	const teams = (await bbgm.idb.cache.teams.getAll()).filter(
		(t) => t.tid !== userTid && !t.disabled,
	);
	const season = bbgm.g.get("season");
	const userPlayers = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		userTid,
	);

	// Find any players we could offer (low value players, expiring contracts, etc.)
	const expiringPlayers = userPlayers.filter(
		(p) =>
			p.contract.exp === season &&
			p.value >= 0 &&
			!bbgm.trade.isUntradable(p).untradable,
	);

	// If no expiring contracts, try with empty offers or minimal compensation
	const playersToOffer = expiringPlayers.length > 0 ? expiringPlayers : [];

	console.log(`Checking ${teams.length} teams for trades...`);

	// Helper function to find optimal combination of players
	async function findOptimalCombination(
		players,
		teamTid,
		pickDpids,
		userTid,
		playersToOffer,
	) {
		let bestCombination = [];
		let bestDv = Infinity;

		// Generate all possible combinations (2^n combinations)
		const n = players.length;
		for (let i = 1; i < 1 << n; i++) {
			const combination = [];
			for (let j = 0; j < n; j++) {
				if (i & (1 << j)) {
					combination.push(players[j]);
				}
			}

			if (combination.length === 0) continue;

			try {
				const testDv = await bbgm.team.valueChange(
					teamTid,
					[],
					combination.map((p) => p.pid),
					[],
					pickDpids,
					undefined,
					userTid,
					playersToOffer.map((p) => p.pid),
				);

				// If viable and closer to 0 than current best, use this combination
				if (testDv > 0 && testDv < bestDv) {
					bestCombination = combination;
					bestDv = testDv;
				}
			} catch (e) {
				// Ignore errors
			}
		}

		return { combination: bestCombination, dv: bestDv };
	}

	// Helper function to find all possible trades for a team
	async function findAllTradesForTeam(team) {
		const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		const picksToTry = picks.filter(
			(p) => (p.round === 1 || p.round === 2) && p.season === season,
		);
		if (picksToTry.length === 0) {
			return { typeATrades: [], remainingTrades: [] };
		}

		const allPlayers = await bbgm.idb.cache.players.indexGetAll(
			"playersByTid",
			team.tid,
		);
		for (const p of allPlayers) {
			await bbgm.player.updateValues(p);
		}

		// Check each player individually to see if CPU considers them negative value
		const negativePlayers = [];
		for (const p of allPlayers) {
			if (await isNegativeTradablePlayer(p, team.tid, userTid)) {
				negativePlayers.push(p);
			}
		}

		if (negativePlayers.length === 0) {
			return { typeATrades: [], remainingTrades: [] };
		}

		const typeATrades = [];
		const remainingTrades = [];

		// Generate all possible pick combinations (single picks and multi-pick combinations)
		const pickCombinations = [];

		// Single picks
		for (const pick of picksToTry) {
			pickCombinations.push([pick]);
		}

		// Multi-pick combinations (if team has multiple picks)
		if (picksToTry.length > 1) {
			// Try all 2-pick combinations
			for (let i = 0; i < picksToTry.length; i++) {
				for (let j = i + 1; j < picksToTry.length; j++) {
					pickCombinations.push([picksToTry[i], picksToTry[j]]);
				}
			}
		}

		// Get all pick combinations and their values
		const pickValues = [];
		for (const pickCombo of pickCombinations) {
			try {
				const pickDpids = pickCombo.map((p) => p.dpid);
				const dv = await bbgm.team.valueChange(
					team.tid,
					[],
					[],
					[],
					pickDpids,
					undefined,
					userTid,
					[],
				);
				const pickValue = -dv;
				pickValues.push({
					picks: pickCombo,
					value: pickValue,
					dv: dv,
					description: pickCombo
						.map((p) => `${p.round === 1 ? "1st" : "2nd"}(${p.season})`)
						.join("+"),
				});
			} catch (e) {
				// Ignore errors
			}
		}

		// Sort by pick value (least valuable first for efficiency)
		pickValues.sort((a, b) => a.value - b.value);

		// Find Type A trades (all players expiring 2025)
		const expiring2025Players = negativePlayers.filter(
			(p) => p.contract.exp === 2025,
		);
		console.log(
			`   🔍 ${team.abbrev}: Found ${expiring2025Players.length} players expiring 2025 out of ${negativePlayers.length} negative players`,
		);
		if (expiring2025Players.length > 0) {
			for (const pickInfo of pickValues) {
				try {
					const pickDpids = pickInfo.picks.map((p) => p.dpid);
					const dvWithAll2025 = await bbgm.team.valueChange(
						team.tid,
						[],
						expiring2025Players.map((p) => p.pid),
						[],
						pickDpids,
						undefined,
						userTid,
						playersToOffer.map((p) => p.pid),
					);

					if (dvWithAll2025 > 0) {
						const result = await findOptimalCombination(
							expiring2025Players,
							team.tid,
							pickDpids,
							userTid,
							playersToOffer,
						);

						if (result.combination.length > 0) {
							typeATrades.push({
								team: team,
								picks: pickInfo.picks,
								negativePlayers: result.combination,
								expiringPlayers: playersToOffer,
								pickValue: pickInfo.value,
								tradeValue: result.dv,
								pickDescription: pickInfo.description,
							});
						}
					} else {
						// This pick combination is too valuable for Type A trade, break early
						break;
					}
				} catch (e) {
					// Ignore errors
				}
			}
		}

		// Find remaining trades (trades that are NOT Type A - i.e., not all 2025 expiring players)
		for (const pickInfo of pickValues) {
			try {
				const pickDpids = pickInfo.picks.map((p) => p.dpid);
				const dvWithAllPlayers = await bbgm.team.valueChange(
					team.tid,
					[],
					negativePlayers.map((p) => p.pid),
					[],
					pickDpids,
					undefined,
					userTid,
					playersToOffer.map((p) => p.pid),
				);

				if (dvWithAllPlayers > 0) {
					const result = await findOptimalCombination(
						negativePlayers,
						team.tid,
						pickDpids,
						userTid,
						playersToOffer,
					);

					if (result.combination.length > 0) {
						// Check if this is a Type A trade (all players expiring 2025)
						const allExpiring2025 = result.combination.every(
							(p) => p.contract.exp === 2025,
						);

						// Only add to remaining trades if it's NOT a Type A trade
						if (!allExpiring2025) {
							console.log(
								`   🔍 ${team.abbrev}: Adding to remaining trades (not all 2025 expiring)`,
							);
							remainingTrades.push({
								team: team,
								picks: pickInfo.picks,
								negativePlayers: result.combination,
								expiringPlayers: playersToOffer,
								pickValue: pickInfo.value,
								tradeValue: result.dv,
								pickDescription: pickInfo.description,
							});
						}
					}
				} else {
					// This pick combination is too valuable for any trade, break early
					break;
				}
			} catch (e) {
				// Ignore errors
			}
		}

		return { typeATrades, remainingTrades };
	}

	// Step 1: Find and execute Type A trades iteratively (re-evaluating after each trade)
	console.log("Step 1: Finding and executing Type A trades...");
	console.log("=".repeat(50));

	let executedCount = 0;
	let maxIterations = 10; // Safety guard to prevent infinite loops
	let iteration = 0;

	while (playersToOffer.length > 0 && iteration < maxIterations) {
		iteration++;
		console.log(
			`🔄 Iteration ${iteration}: ${playersToOffer.length} players available`,
		);

		// Find all possible Type A trades with current playersToOffer
		const allTypeATrades = [];
		for (const team of teams) {
			const trades = await findAllTradesForTeam(team);
			allTypeATrades.push(...trades.typeATrades);
		}

		if (allTypeATrades.length === 0) {
			console.log("❌ No more Type A trades possible with remaining players");
			break;
		}

		console.log(`📊 Found ${allTypeATrades.length} Type A trades to test...`);

		// Sort by pick value (most valuable first)
		allTypeATrades.sort((a, b) => b.pickValue - a.pickValue);

		// Try to execute the most valuable trade
		const bestTrade = allTypeATrades[0];
		console.log(
			`🎯 Attempting Type A trade with ${bestTrade.team.abbrev}: ${bestTrade.pickDescription} (value: ${bestTrade.pickValue.toFixed(2)})`,
		);

		const success = await executeTrade(bestTrade);

		if (success) {
			executedCount++;
			// Remove the traded players from playersToOffer
			const tradedPlayerPids = new Set(
				bestTrade.expiringPlayers.map((p) => p.pid),
			);
			playersToOffer = playersToOffer.filter(
				(p) => !tradedPlayerPids.has(p.pid),
			);
			console.log(
				`✅ Type A Trade ${executedCount} successful! ${playersToOffer.length} players remaining`,
			);
		} else {
			// If the best trade failed, remove it and try the next one
			allTypeATrades.shift();
			if (allTypeATrades.length === 0) {
				console.log("❌ No more viable Type A trades");
				break;
			}
		}
	}

	console.log(
		`✅ Type A Auto-execution complete: ${executedCount} Type A trades successful`,
	);
	console.log("");

	// Step 2: Find remaining trades from all teams
	console.log("Step 2: Finding remaining trades...");
	console.log("=".repeat(50));

	const remainingTrades = [];

	for (const team of teams) {
		const trades = await findAllTradesForTeam(team);

		// Take the best trade for this team (highest pick value)
		const allRemainingTrades = [...trades.remainingTrades];
		if (allRemainingTrades.length > 0) {
			const bestTrade = allRemainingTrades.reduce((best, current) =>
				current.pickValue > best.pickValue ? current : best,
			);

			remainingTrades.push(bestTrade);
		}
	}

	// Sort remaining trades by pick value (most valuable first)
	remainingTrades.sort((a, b) => b.pickValue - a.pickValue);

	// Display remaining trades for manual review (don't auto-execute)
	if (remainingTrades.length > 0) {
		console.log(
			`📊 Found ${remainingTrades.length} remaining trades for manual review:`,
		);
		console.log("");

		for (let i = 0; i < remainingTrades.length; i++) {
			const trade = remainingTrades[i];
			const expiring2025 = trade.negativePlayers.filter(
				(p) => p.contract.exp === 2025,
			);
			const expiring2026Plus = trade.negativePlayers.filter(
				(p) => p.contract.exp > 2025,
			);

			console.log(
				`${i + 1}. ${trade.team.abbrev}: ${trade.pickDescription} (value: ${trade.pickValue.toFixed(2)})`,
			);
			console.log(
				`   📊 2025 expiring: ${expiring2025.length} | 2026+: ${expiring2026Plus.length}`,
			);
			console.log(
				`   📤 Would send: ${trade.expiringPlayers.length} expiring contracts`,
			);
			console.log(
				`   📥 Would receive: ${trade.picks.map((p) => `${p.round === 1 ? "1st" : "2nd"}(${p.season})`).join("+")} + ${trade.negativePlayers.length} players`,
			);
			console.log("");
		}
	} else {
		console.log("📊 No remaining trades found for manual review.");
	}

	console.log(
		`✅ Remaining trades review complete: ${remainingTrades.length} trades found`,
	);
	console.log("");

	// Final summary
	if (executedCount === 0) {
		console.log("❌ No Type A trades found or executed.");
	} else {
		console.log(`🎉 Type A trades executed: ${executedCount}`);
	}
}

async function executeTrade(trade) {
	try {
		// Create the trade using the correct API format
		await bbgm.trade.create([
			{
				tid: bbgm.g.get("userTid"),
				pids: trade.expiringPlayers.map((p) => p.pid),
				pidsExcluded: [],
				dpids: [],
				dpidsExcluded: [],
			},
			{
				tid: trade.team.tid,
				pids: trade.negativePlayers.map((p) => p.pid),
				pidsExcluded: [],
				dpids: trade.picks.map((p) => p.dpid),
				dpidsExcluded: [],
			},
		]);

		// Propose and accept the trade
		const [success, message] = await bbgm.trade.propose(false);

		if (success) {
			console.log(`   ✅ Trade executed with ${trade.team.abbrev}!`);
			console.log(
				`      📥 Received: ${trade.picks.map((p) => `${p.round === 1 ? "1st" : "2nd"}(${p.season})`).join("+")} + ${trade.negativePlayers.length} players`,
			);
			console.log(
				`      📤 Sent: ${trade.expiringPlayers.length} expiring contracts`,
			);
			return true;
		} else {
			console.log(`   ❌ Trade with ${trade.team.abbrev} failed: ${message}`);
			return false;
		}
	} catch (e) {
		console.log(
			`   ❌ Error executing trade with ${trade.team.abbrev}: ${e.message}`,
		);
		return false;
	}
}

async function isNegativeTradablePlayer(p, teamTid, userTid) {
	if (bbgm.trade.isUntradable(p).untradable) {
		return false;
	}

	try {
		// Check if CPU considers this player negative value by seeing if they'd pay to get rid of them
		const dv = await bbgm.team.valueChange(
			teamTid,
			[],
			[p.pid],
			[],
			[],
			undefined,
			userTid,
			[],
		);
		// If dv > 0, CPU would pay to get rid of this player (negative value)
		// If dv < 0, CPU would need compensation to give up this player (positive value)
		return dv > 0;
	} catch (e) {
		return false;
	}
}

await findMostValuablePicks();
