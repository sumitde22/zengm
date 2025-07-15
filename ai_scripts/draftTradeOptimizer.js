// Run in the worker console after the draft lottery to optimize draft trades.
// This script assumes all draft picks have been assigned their final positions.

// Constants
const DRAFT_PHASE = 5; // PHASE.DRAFT
const MAX_COMBO_SIZE = 15;
const MAX_PATH_STEPS = 60;

// Helper: get all picks currently owned by user, sorted best to worst
async function getSortedUserPicks() {
	return (await getUserDraftPicks()).sort((a, b) =>
		a.round !== b.round ? a.round - b.round : a.pick - b.pick,
	);
}

// Get user's draft picks sorted by value (highest first)
async function getUserDraftPicks() {
	const userTid = bbgm.g.get("userTid");
	const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		userTid,
	);

	// After draft lottery, all picks should have actual pick numbers
	// Sort by pick value (lower pick number = higher value)
	return picks.sort((a, b) => {
		// Primary sort by round
		if (a.round !== b.round) {
			return a.round - b.round;
		}

		// Secondary sort by pick number within round
		return a.pick - b.pick;
	});
}

// Check if a player is considered negative value by the CPU team
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

// Get user's players with negative value that can be traded (never trade away players drafted by user's team)
async function getNegativeValuePlayers(draftYear) {
	const userTid = bbgm.g.get("userTid");
	const players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		userTid,
	);

	const filteredPlayers = [];
	for (const p of players) {
		// Check if player is untradable
		const untradable = bbgm.trade.isUntradable(p);
		if (untradable.untradable) {
			continue;
		}

		// Never trade away players drafted by user's team (sentimental value)
		if (p.draft && p.draft.originalTid === userTid) {
			continue;
		}

		// Exclude players whose contract expires in or before the draft year
		if (!p.contract || p.contract.exp <= draftYear) {
			continue;
		}

		// Check if we would pay to get rid of this player (negative value)
		try {
			const dv = await bbgm.team.valueChange(
				userTid,
				[],
				[p.pid],
				[],
				[],
				undefined,
				userTid,
				[],
			);
			// If dv > 0, we would pay to get rid of this player (negative value)
			if (dv > 0) {
				filteredPlayers.push(p);
			}
		} catch (e) {
			// Skip if there's an error
		}
	}

	return filteredPlayers.sort((a, b) => a.value - b.value); // Sort by most negative first
}

// Get all teams except user's team
async function getOtherTeams() {
	const userTid = bbgm.g.get("userTid");
	const teams = await bbgm.idb.cache.teams.getAll();
	return teams.filter((t) => t.tid !== userTid && !t.disabled);
}

// Evaluate a trade using the game's value change system and check CPU team's salary cap constraints
async function evaluateTrade(teams) {
	try {
		// Check if the CPU team would violate salary cap rules (ignore user team constraints)
		const summary = await bbgm.trade.summary(teams);
		if (summary.warning) {
			// Check if the warning is specifically about the CPU team (teams[1]) being over cap
			const cpuTeamName = bbgm.g.get("teamInfoCache")[teams[1].tid]?.name;
			if (summary.warning.includes(cpuTeamName)) {
				// CPU team can't handle this trade due to salary cap, reject it
				return -Infinity;
			}
			// If warning is about user team, ignore it since we have cap space
		}

		// Calculate value change from CPU team's perspective (they need to accept the trade)
		const cpuDv = await bbgm.team.valueChange(
			teams[1].tid, // CPU team
			teams[0].pids, // What they're getting
			teams[1].pids, // What they're giving
			teams[0].dpids, // Draft picks they're getting
			teams[1].dpids, // Draft picks they're giving
			undefined,
			teams[0].tid, // Our team
			[],
		);

		// For debugging: also calculate our perspective
		const ourDv = await bbgm.team.valueChange(
			teams[0].tid, // Our team
			teams[1].pids, // What we're getting
			teams[0].pids, // What we're giving
			teams[1].dpids, // Draft picks we're getting
			teams[0].dpids, // Draft picks we're giving
			undefined,
			teams[1].tid, // Other team
			[],
		);

		return cpuDv; // Return CPU team's value change (they need to accept)
	} catch (error) {
		console.log("Error evaluating trade:", error);
		return -Infinity;
	}
}

// Create a trade structure for the game's trade system
function createTradeStructure(
	userTid,
	userPids,
	userDpids,
	cpuTid,
	cpuPids,
	cpuDpids,
) {
	return [
		{
			tid: userTid,
			pids: userPids || [],
			pidsExcluded: [],
			dpids: userDpids || [],
			dpidsExcluded: [],
		},
		{
			tid: cpuTid,
			pids: cpuPids || [],
			pidsExcluded: [],
			dpids: cpuDpids || [],
			dpidsExcluded: [],
		},
	];
}

// Execute a trade and return success status
async function executeTrade(teams, description) {
	await bbgm.trade.create(teams);
	const [success, message] = await bbgm.trade.propose(false);
	if (success) {
		console.log(`✅ ${description}`);
	} else {
		console.log(`❌ Trade failed: ${message}`);
	}
	return success;
}

// Try to acquire picks by taking on negative value players from other teams
async function acquireFreePicks() {
	const userTid = bbgm.g.get("userTid");
	const otherTeams = await getOtherTeams();
	let totalPicksAcquired = 0;

	for (const team of otherTeams) {
		const teamPicks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		const teamPlayers = await bbgm.idb.cache.players.indexGetAll(
			"playersByTid",
			team.tid,
		);

		// Update player values first
		for (const p of teamPlayers) {
			await bbgm.player.updateValues(p);
		}
		const currentSeason = bbgm.g.get("season");
		// Check each pick individually to see if CPU considers it negative value
		for (const pick of teamPicks) {
			// Only consider picks from the current draft year
			if (pick.season !== currentSeason) continue;
			let foundTrade = false;
			const draftYear = pick.season;

			// Check each player individually to see if CPU considers them negative value
			const negativePlayers = [];
			for (const p of teamPlayers) {
				// Exclude players whose contract expires in or before the draft year
				if (!p.contract || p.contract.exp <= draftYear) continue;
				if (await isNegativeTradablePlayer(p, team.tid, userTid)) {
					negativePlayers.push(p);
				}
			}
			// Sort by value (least negative first, closest to 0)
			negativePlayers.sort((a, b) => b.value - a.value);

			for (const negPlayer of negativePlayers) {
				const teams = createTradeStructure(
					userTid,
					[],
					[],
					team.tid,
					[negPlayer.pid],
					[pick.dpid],
				);
				const dv = await evaluateTrade(teams);
				if (dv > 0) {
					const description = `Acquiring pick: ${await bbgm.helpers.pickDesc(pick, "short")} + ${negPlayer.firstName} ${negPlayer.lastName} (${negPlayer.value.toFixed(1)}) from ${bbgm.g.get("teamInfoCache")[team.tid]?.abbrev}`;
					const success = await executeTrade(teams, description);
					if (success) {
						totalPicksAcquired++;
						foundTrade = true;
						break;
					}
				}
			}

			if (foundTrade) continue;

			// Try combinations of two negative value players if needed
			if (negativePlayers.length >= 2) {
				for (let i = 0; i < negativePlayers.length; i++) {
					for (let j = i + 1; j < negativePlayers.length; j++) {
						const neg1 = negativePlayers[i];
						const neg2 = negativePlayers[j];
						const teams = createTradeStructure(
							userTid,
							[],
							[],
							team.tid,
							[neg1.pid, neg2.pid],
							[pick.dpid],
						);
						const dv = await evaluateTrade(teams);
						if (dv > 0) {
							const description = `Acquiring pick: ${await bbgm.helpers.pickDesc(pick, "short")} + ${neg1.firstName} ${neg1.lastName} (${neg1.value.toFixed(1)}) + ${neg2.firstName} ${neg2.lastName} (${neg2.value.toFixed(1)}) from ${bbgm.g.get("teamInfoCache")[team.tid]?.abbrev}`;
							const success = await executeTrade(teams, description);
							if (success) {
								totalPicksAcquired++;
								foundTrade = true;
								break;
							}
						}
					}
					if (foundTrade) break;
				}
			}
		}
	}

	return totalPicksAcquired;
}

// Try to trade up from a specific pick, taking on negative value players if needed
async function tradeUpFromPick(pick, negativePlayers) {
	const userTid = bbgm.g.get("userTid");
	const otherTeams = await getOtherTeams();

	// Get all higher picks from other teams
	const allHigherPicks = [];
	for (const team of otherTeams) {
		const teamPicks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		for (const teamPick of teamPicks) {
			// Only consider picks from the same draft year
			if (teamPick.season !== pick.season) continue;
			// Only consider picks that are actually better (lower round or same round but lower pick)
			if (
				teamPick.round < pick.round ||
				(teamPick.round === pick.round && teamPick.pick < pick.pick)
			) {
				allHigherPicks.push({ pick: teamPick, team });
			}
		}
	}

	// Sort by value (best picks first)
	allHigherPicks.sort((a, b) => {
		// Primary sort by round
		if (a.pick.round !== b.pick.round) {
			return a.pick.round - b.pick.round;
		}
		// Secondary sort by pick number within round
		return a.pick.pick - b.pick.pick;
	});

	// Try each higher pick
	for (const { pick: higherPick, team } of allHigherPicks) {
		const draftYear = higherPick.season;
		// Check each player individually to see if CPU considers them negative value
		const negativePlayers = [];
		for (const p of teamPlayers) {
			// Exclude players whose contract expires in or before the draft year
			if (!p.contract || p.contract.exp <= draftYear) continue;
			if (await isNegativeTradablePlayer(p, team.tid, userTid)) {
				negativePlayers.push(p);
			}
		}
		// Sort by value (least negative first, closest to 0)
		negativePlayers.sort((a, b) => b.value - a.value);

		// Start with just the pick swap
		let teams = createTradeStructure(
			userTid,
			[],
			[pick.dpid],
			team.tid,
			[],
			[higherPick.dpid],
		);

		let dv = await evaluateTrade(teams);

		// If the AI accepts, great!
		if (dv > 0) {
			const description = `Trading up: ${await bbgm.helpers.pickDesc(pick, "short")} → ${await bbgm.helpers.pickDesc(higherPick, "short")}`;
			const success = await executeTrade(teams, description);
			if (success) {
				return true;
			}
		}

		// If not, try adding negative value players to sweeten the deal
		for (const negPlayer of negativePlayers) {
			// Add this negative player to the trade
			teams[0].pids.push(negPlayer.pid);

			dv = await evaluateTrade(teams);

			if (dv > 0) {
				const description = `Trading up with negative player: ${await bbgm.helpers.pickDesc(pick, "short")} + ${negPlayer.firstName} ${negPlayer.lastName} (${negPlayer.value.toFixed(1)}) → ${await bbgm.helpers.pickDesc(higherPick, "short")}`;
				const success = await executeTrade(teams, description);
				if (success) {
					return true;
				}
			}

			// Remove the player and try the next one
			teams[0].pids.pop();
		}
	}

	return false;
}

// Strict greedy trade up: for a given pick, keep trading up as high as possible before moving to the next pick
async function tradeUpChainFromPick(startPick, negativePlayers) {
	let pick = startPick;
	let totalTrades = 0;
	while (true) {
		const success = await tradeUpFromPick(pick, negativePlayers);
		if (!success) break;
		// After a successful trade, find the new pick (should be the highest pick now owned by user that is higher than the previous one)
		const userPicks = await getUserDraftPicks();
		const higherPicks = userPicks.filter((p) => {
			// Only consider picks from the same draft year
			if (p.season !== pick.season) return false;
			// Only consider better picks
			if (p.round < pick.round) return true;
			if (p.round === pick.round && p.pick < pick.pick) return true;
			return false;
		});
		if (higherPicks.length === 0) break;
		// Get the highest (best) pick
		higherPicks.sort((a, b) => {
			// Primary sort by round
			if (a.round !== b.round) {
				return a.round - b.round;
			}
			// Secondary sort by pick number within round
			return a.pick - b.pick;
		});
		pick = higherPicks[0];
		totalTrades++;
	}
	return totalTrades;
}

// Find the optimal trade-up path for a pick using Dijkstra's algorithm
async function findOptimalTradeUpPath(
	startPick,
	negativePlayers,
	maxCombo = MAX_COMBO_SIZE,
	maxSteps = MAX_PATH_STEPS,
) {
	const userTid = bbgm.g.get("userTid");
	const allPicks = [];
	const pickKey = (p) => `${p.season}:${p.round}:${p.pick}:${p.tid}`;
	// Compare picks within the same draft year only
	const pickCompare = (a, b) => {
		// Only compare by round and pick number within the same year
		if (a.round !== b.round) {
			return a.round - b.round;
		}
		return a.pick - b.pick;
	};

	// Build a list of all picks in the current draft year only
	const currentSeason = startPick.season;
	for (const team of await bbgm.idb.cache.teams.getAll()) {
		if (team.disabled) continue;
		const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		for (const pick of picks) {
			// Only include picks from the current draft year
			if (pick.season === currentSeason) {
				allPicks.push({ ...pick });
			}
		}
	}
	// Sort picks and create mapping
	const picksList = allPicks.sort(pickCompare);
	const pickMap = {};
	for (const p of picksList) pickMap[pickKey(p)] = p;

	// Dijkstra's: node = pickKey, cost = total negative value taken on
	const startKey = pickKey(startPick);
	const dist = { [startKey]: 0 };
	const prev = {};
	const prevTrade = {};
	const visited = new Set();
	const queue = [{ key: startKey, cost: 0 }];

	let dijkstraIterations = 0;
	const maxDijkstraIterations = 500; // Reduced safety guard for Dijkstra's
	let totalTradeEvaluations = 0;
	let totalTradeEvaluationTime = 0;

	while (queue.length > 0 && dijkstraIterations < maxDijkstraIterations) {
		dijkstraIterations++;

		// Get node with lowest cost (simple min find instead of full sort)
		let minIndex = 0;
		for (let i = 1; i < queue.length; i++) {
			if (queue[i].cost < queue[minIndex].cost) {
				minIndex = i;
			}
		}
		const { key: curKey, cost: curCost } = queue.splice(minIndex, 1)[0];
		if (visited.has(curKey)) continue;
		visited.add(curKey);
		const curPick = pickMap[curKey];
		if (!curPick) continue;
		// For all better picks within the same draft year
		for (const nextPick of picksList) {
			// Only consider picks that are actually better (lower round or same round but lower pick)
			if (nextPick.round > curPick.round) continue;
			if (nextPick.round === curPick.round && nextPick.pick >= curPick.pick)
				continue;
			// Skip if we already own this pick
			if (nextPick.tid === userTid) continue;
			const team = await bbgm.idb.cache.teams.get(nextPick.tid);
			if (!team || team.disabled) continue;
			const teamPlayers = await bbgm.idb.cache.players.indexGetAll(
				"playersByTid",
				team.tid,
			);

			// Update player values for accurate evaluation
			for (const p of teamPlayers) {
				await bbgm.player.updateValues(p);
			}

			// Check each player individually to see if CPU considers them negative value
			const negPlayers = [];
			for (const p of teamPlayers) {
				// Exclude players whose contract expires in or before the draft year
				if (!p.contract || p.contract.exp <= currentSeason) continue;
				if (await isNegativeTradablePlayer(p, team.tid, userTid)) {
					negPlayers.push(p);
				}
			}

			// Sort negative players by value (least negative first, closest to 0)
			negPlayers.sort((a, b) => b.value - a.value);

			// Prioritize dumping our negative players while minimizing what we take on
			let bestDv = -Infinity;
			let bestComboPids = [];
			let bestOurNegPids = [];
			let bestTotalNegValue = Infinity;
			let bestOurDumpValue = 0; // Track how much we're dumping (more negative = better)

			// Start with just the pick swap
			let baseTeams = createTradeStructure(
				userTid,
				[],
				[curPick.dpid],
				nextPick.tid,
				[],
				[nextPick.dpid],
			);
			let currentDv = await evaluateTrade(baseTeams);
			if (currentDv > 0) {
				bestDv = currentDv;
				bestTotalNegValue = 0; // No negative value taken on
				bestOurDumpValue = 0; // No players dumped
			}

			// Smart combination testing: generate all valid combinations and test in optimal order
			const allValidCombinations = [];
			let tradeEvaluationsForThisPick = 0;
			let tradeEvaluationTimeForThisPick = 0;

			// Helper function to generate combinations
			function generateCombinations(arr, size) {
				if (size === 0) return [[]];
				if (arr.length === 0) return [];

				const [first, ...rest] = arr;
				const withoutFirst = generateCombinations(rest, size);
				const withFirst = generateCombinations(rest, size - 1).map((combo) => [
					first,
					...combo,
				]);

				return [...withoutFirst, ...withFirst];
			}

			// SMART HEURISTIC SEARCH: Find optimal trade without testing every combination

			// Sort their negative players by value (least negative first - most likely to work)
			const sortedNegPlayers = [...negPlayers].sort(
				(a, b) => b.value - a.value,
			);

			// Sort our negative players by value (least negative first - most likely to be accepted)
			const sortedOurNegativePlayers = [...negativePlayers].sort(
				(a, b) => b.value - a.value,
			);

			// Strategy 1: Try single best players first (most likely to work)
			let bestTrade = null;
			let bestScore = -Infinity;

			// Test single players first (most efficient)
			for (const theirPlayer of sortedNegPlayers.slice(0, 10)) {
				// Top 10 most valuable
				baseTeams[1].pids = [theirPlayer.pid];
				baseTeams[0].pids = [];

				const evalStartTime = Date.now();
				const theirOnlyDv = await evaluateTrade(baseTeams);
				const evalTime = Date.now() - evalStartTime;

				tradeEvaluationsForThisPick++;
				tradeEvaluationTimeForThisPick += evalTime;
				totalTradeEvaluations++;
				totalTradeEvaluationTime += evalTime;

				if (theirOnlyDv > 0) {
					const score = theirOnlyDv - Math.abs(theirPlayer.value) * 0.1;
					if (score > bestScore) {
						bestScore = score;
						bestTrade = {
							theirPlayers: [theirPlayer],
							ourPlayers: [],
							totalNegValue: Math.abs(theirPlayer.value),
							ourDumpValue: 0,
							dv: theirOnlyDv,
							score: score,
						};
					}
				}
			}

			// Strategy 2: Try best 2-player combinations (if single players didn't work well)
			if (!bestTrade || bestTrade.dv < 0.5) {
				// If no good single trades, try pairs

				for (let i = 0; i < Math.min(5, sortedNegPlayers.length); i++) {
					for (let j = i + 1; j < Math.min(10, sortedNegPlayers.length); j++) {
						const player1 = sortedNegPlayers[i];
						const player2 = sortedNegPlayers[j];

						baseTeams[1].pids = [player1.pid, player2.pid];
						baseTeams[0].pids = [];

						const evalStartTime = Date.now();
						const theirOnlyDv = await evaluateTrade(baseTeams);
						const evalTime = Date.now() - evalStartTime;

						tradeEvaluationsForThisPick++;
						tradeEvaluationTimeForThisPick += evalTime;
						totalTradeEvaluations++;
						totalTradeEvaluationTime += evalTime;

						if (theirOnlyDv > 0) {
							const totalNegValue =
								Math.abs(player1.value) + Math.abs(player2.value);
							const score = theirOnlyDv - totalNegValue * 0.1;
							if (score > bestScore) {
								bestScore = score;
								bestTrade = {
									theirPlayers: [player1, player2],
									ourPlayers: [],
									totalNegValue: totalNegValue,
									ourDumpValue: 0,
									dv: theirOnlyDv,
									score: score,
								};
							}
						}
					}
				}
			}

			// Strategy 3: Try adding our negative players to sweeten the best trade found
			if (bestTrade && sortedOurNegativePlayers.length > 0) {
				// Try adding 1-2 of our least negative players to the best trade
				const maxOurPlayersToTry = Math.min(2, sortedOurNegativePlayers.length);
				let foundAnyImprovement = false;

				for (
					let numOurPlayers = 1;
					numOurPlayers <= maxOurPlayersToTry;
					numOurPlayers++
				) {
					// Try combinations of our least negative players (most likely to be accepted)
					for (
						let i = 0;
						i <= sortedOurNegativePlayers.length - numOurPlayers;
						i++
					) {
						const ourPlayersToTry = sortedOurNegativePlayers.slice(
							i,
							i + numOurPlayers,
						);

						baseTeams[1].pids = bestTrade.theirPlayers.map((p) => p.pid);
						baseTeams[0].pids = ourPlayersToTry.map((p) => p.pid);

						const evalStartTime = Date.now();
						const combinedDv = await evaluateTrade(baseTeams);
						const evalTime = Date.now() - evalStartTime;

						tradeEvaluationsForThisPick++;
						tradeEvaluationTimeForThisPick += evalTime;
						totalTradeEvaluations++;
						totalTradeEvaluationTime += evalTime;

						if (combinedDv > bestTrade.dv) {
							const totalOurDumpValue = ourPlayersToTry.reduce(
								(sum, p) => sum + p.value,
								0,
							);

							// Sweeten the deal by dumping our negative players
							const score =
								combinedDv -
								bestTrade.totalNegValue * 0.1 +
								Math.abs(totalOurDumpValue) * 0.3;

							bestTrade = {
								theirPlayers: bestTrade.theirPlayers,
								ourPlayers: ourPlayersToTry,
								totalNegValue: bestTrade.totalNegValue,
								ourDumpValue: totalOurDumpValue,
								dv: combinedDv,
								score: score,
							};
							foundAnyImprovement = true;
						} else {
							// Early exit: if CPU won't accept this "least bad" contract, they won't accept worse ones
							break;
						}
					}
					// Early exit: if we couldn't add any single player, don't try combinations
					if (numOurPlayers === 1 && !foundAnyImprovement) {
						break;
					}
				}
			}

			// Add the best trade to our list if we found one
			if (bestTrade) {
				allValidCombinations.push(bestTrade);
			}

			// Sort combinations by score (best first)
			allValidCombinations.sort((a, b) => b.score - a.score);

			// Test combinations in optimal order (limit to top 10 to avoid too many tests)
			for (const combo of allValidCombinations.slice(0, 10)) {
				const { theirPlayers, ourPlayers, totalNegValue, ourDumpValue, dv } =
					combo;

				// Check if this is better than our current best
				// Prioritize trades that dump our negative players (higher ourDumpValue is better)
				if (
					dv > 0 &&
					(ourDumpValue > bestOurDumpValue || totalNegValue < bestTotalNegValue)
				) {
					bestDv = dv;
					bestComboPids = theirPlayers.map((p) => p.pid);
					bestOurNegPids = ourPlayers.map((p) => p.pid);
					bestTotalNegValue = totalNegValue;
					bestOurDumpValue = ourDumpValue;
					break; // Take the first (best) successful combination
				}
			}

			if (bestDv > 0) {
				const nextKey = pickKey(nextPick);
				const newCost = curCost - bestDv; // Negative because we want to minimize cost
				if (dist[nextKey] === undefined || newCost < dist[nextKey]) {
					dist[nextKey] = newCost;
					prev[nextKey] = curKey;
					prevTrade[nextKey] = {
						from: curPick,
						to: nextPick,
						negPlayers: negPlayers.filter((p) => bestComboPids.includes(p.pid)),
						negPids: bestComboPids,
						ourNegPids: bestOurNegPids,
						cost: -bestDv, // Negative because we want to minimize cost
					};
					if (Object.keys(prev).length < maxSteps) {
						queue.push({ key: nextKey, cost: newCost });
					}
				}
			}
		}
	}

	if (dijkstraIterations >= maxDijkstraIterations) {
		console.log("⚠️  Reached maximum iterations, stopping");
	}

	// Find the best pick reachable (lowest round, lowest pick) with a path
	const reachable = Object.keys(dist).filter((k) => k !== startKey);
	if (reachable.length === 0) return null;
	reachable.sort((a, b) => pickCompare(pickMap[a], pickMap[b]));
	const bestKey = reachable[0];
	// Reconstruct path
	const path = [];
	let cur = bestKey;
	while (cur && prevTrade[cur]) {
		path.unshift(prevTrade[cur]);
		cur = prev[cur];
	}
	return path;
}

// Execute a sequence of trades along a path
async function executeTradeUpPath(path) {
	for (const step of path) {
		const { from, to, negPlayers, negPids, ourNegPids } = step;
		const teams = createTradeStructure(
			bbgm.g.get("userTid"),
			ourNegPids || [],
			[from.dpid],
			to.tid,
			negPids,
			[to.dpid],
		);

		// Get our negative players for the description
		const ourNegPlayers = [];
		if (ourNegPids && ourNegPids.length > 0) {
			for (const pid of ourNegPids) {
				const player = await bbgm.idb.cache.players.get(pid);
				if (player) {
					ourNegPlayers.push(player);
				}
			}
		}
		const ourNegDesc =
			ourNegPlayers.length > 0
				? ` + [${ourNegPlayers.map((p) => p.firstName + " " + p.lastName + ` (${p.value.toFixed(1)})`).join(", ")}]`
				: "";
		const description = `Executing trade: ${await bbgm.helpers.pickDesc(from, "short")}${ourNegDesc} → ${await bbgm.helpers.pickDesc(to, "short")} + [${negPlayers.map((p) => p.firstName + " " + p.lastName + ` (${p.value.toFixed(1)})`).join(", ")}]`;

		const success = await executeTrade(teams, description);
		if (!success) {
			return false; // Return false if any trade in the path fails
		}
	}
	return true; // Return true if all trades in the path succeeded
}

// Main function to optimize draft trades (optimal path-dependent)
async function optimizeDraftTrades() {
	// Validate that we're running during the draft phase
	const currentPhase = bbgm.g.get("phase");

	if (currentPhase !== DRAFT_PHASE) {
		console.log(
			"❌ This script should be run during the draft phase (5). Current phase: " +
				currentPhase,
		);
		return;
	}

	const currentSeason = bbgm.g.get("season");
	const userPicksInitial = (await getUserDraftPicks()).filter(
		(p) => p.season === currentSeason,
	);
	if (userPicksInitial.length === 0) {
		console.log(
			"❌ No draft picks found for this season. Make sure you have draft picks for the current draft year.",
		);
		return;
	}
	const draftYear = currentSeason;

	// Step 1: Trade up from existing picks (optimal path-dependent)
	let tradesExecuted = 0;
	const pickQueue = userPicksInitial.slice(); // Only current season picks

	// Get initial negative players
	const initialNegativePlayers = await getNegativeValuePlayers(draftYear);

	// Find and execute optimal trade paths for each pick
	for (const pick of pickQueue) {
		// Get current negative players (updated after each trade)
		const negativePlayers = await getNegativeValuePlayers(draftYear);

		const path = await findOptimalTradeUpPath(pick, negativePlayers);
		if (path && path.length > 0) {
			const success = await executeTradeUpPath(path);
			if (success) {
				tradesExecuted += path.length;
			}
		}
	}

	// Step 2: Try to acquire free picks (by taking on negative value players)
	const picksBefore = (await getUserDraftPicks()).map((p) => p.dpid);
	const freePicksAcquired = await acquireFreePicks();
	const picksAfter = (await getUserDraftPicks()).map((p) => p.dpid);
	const newFreePickDpids = picksAfter.filter(
		(dpid) => !picksBefore.includes(dpid),
	);

	// Step 3: Trade up from the newly acquired free picks (optimal path-dependent)
	if (newFreePickDpids.length > 0) {
		let freePickTradesExecuted = 0;
		const seenFreeDpids = new Set();
		const freePicksToTry = (await getUserDraftPicks())
			.filter((p) => newFreePickDpids.includes(p.dpid))
			.sort((a, b) =>
				a.round !== b.round ? a.round - b.round : a.pick - b.pick,
			);
		for (const pick of freePicksToTry) {
			if (seenFreeDpids.has(pick.dpid)) continue;
			const negativePlayers = await getNegativeValuePlayers(draftYear);
			const path = await findOptimalTradeUpPath(pick, negativePlayers);
			if (path && path.length > 0) {
				await executeTradeUpPath(path);
				freePickTradesExecuted += path.length;
				const userPicksNow = await getUserDraftPicks();
				for (const p of userPicksNow) {
					seenFreeDpids.add(p.dpid);
				}
			}
		}
	}

	console.log(`\n🎉 Draft trade optimization complete!`);
	console.log(`Total trades executed: ${tradesExecuted}`);
	console.log(`Free picks acquired: ${freePicksAcquired}`);

	// Show final draft picks
	const finalPicks = await getUserDraftPicks();
	console.log(`\nFinal draft picks:`);
	for (const pick of finalPicks) {
		console.log(`  ${await bbgm.helpers.pickDesc(pick, "short")}`);
	}
}

// Run the optimization
await optimizeDraftTrades();
