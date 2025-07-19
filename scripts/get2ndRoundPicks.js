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

	console.log(`Checking ${teams.length} teams for picks to dump...`);
	let teamsWithPicks = 0;
	let teamsWithNegativePlayers = 0;
	let teamsWithViableTrades = 0;

	const availablePicks = [];

	for (const team of teams) {
		const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		const picksToTry = picks.filter(
			(p) => (p.round === 1 || p.round === 2) && p.season === season,
		);
		if (picksToTry.length === 0) {
			continue;
		}
		teamsWithPicks++;

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
			continue;
		}
		teamsWithNegativePlayers++;

		// Find the most valuable pick that the team is willing to give up
		// Test picks from most valuable to least valuable
		let mostValuableWillingPick = null;
		let mostValuableWillingValue = -Infinity;

		console.log(`Checking picks for ${team.abbrev}:`);

		// First, get all picks and their values
		const pickValues = [];
		for (const pickOption of picksToTry) {
			try {
				const dv = await bbgm.team.valueChange(
					team.tid,
					[],
					[],
					[],
					[pickOption.dpid],
					undefined,
					userTid,
					[],
				);
				const pickValue = -dv;
				pickValues.push({ pick: pickOption, value: pickValue, dv: dv });
				console.log(
					`  ${pickOption.round === 1 ? "1st" : "2nd"} round: dv=${dv.toFixed(2)}, pickValue=${pickValue.toFixed(2)}`,
				);
			} catch (e) {
				console.log(
					`  ${pickOption.round === 1 ? "1st" : "2nd"} round: Error - ${e.message}`,
				);
			}
		}

		// Sort by pick value (most valuable first)
		pickValues.sort((a, b) => b.value - a.value);

		// Test each pick from most valuable to least valuable
		for (const pickInfo of pickValues) {
			try {
				const dv = await bbgm.team.valueChange(
					team.tid,
					[],
					negativePlayers.map((p) => p.pid),
					[],
					[pickInfo.pick.dpid],
					undefined,
					userTid,
					playersToOffer.map((p) => p.pid),
				);
				console.log(
					`  Testing trade with ${pickInfo.pick.round === 1 ? "1st" : "2nd"} round (value=${pickInfo.value.toFixed(2)}): dv=${dv.toFixed(2)}`,
				);
				if (dv > 0) {
					mostValuableWillingPick = pickInfo.pick;
					mostValuableWillingValue = pickInfo.value;
					console.log(`    -> Team willing to give up this pick!`);
					break; // Found the most valuable pick they're willing to give up
				}
			} catch (e) {
				console.log(
					`  Trade evaluation error for ${pickInfo.pick.round === 1 ? "1st" : "2nd"} round: ${e.message}`,
				);
			}
		}

		if (!mostValuableWillingPick) {
			console.log(`  No picks that ${team.abbrev} is willing to give up`);
			continue;
		}
		console.log(
			`  Most valuable pick ${team.abbrev} is willing to give up: ${mostValuableWillingPick.round === 1 ? "1st" : "2nd"} round, value=${mostValuableWillingValue.toFixed(2)}`,
		);

		// Add to available picks
		teamsWithViableTrades++;
		availablePicks.push({
			team: team,
			pick: mostValuableWillingPick,
			negativePlayers: negativePlayers,
			valueChange: 0, // We'll recalculate this
			pickValue: mostValuableWillingValue,
		});
		console.log(`  -> ${team.abbrev} added to viable trades`);
		console.log("");
	}

	console.log(`Teams with 1st/2nd round picks: ${teamsWithPicks}`);
	console.log(`Teams with negative players: ${teamsWithNegativePlayers}`);
	console.log(`Teams with viable trades: ${teamsWithViableTrades}`);

	if (availablePicks.length === 0) {
		console.log("No teams willing to dump picks found.");
		return;
	}

	// Sort by pick value (most valuable first)
	availablePicks.sort((a, b) => b.pickValue - a.pickValue);

	console.log(
		`Found ${availablePicks.length} teams willing to dump their most valuable pick:`,
	);
	console.log("");

	availablePicks.forEach((item, index) => {
		console.log(
			`${index + 1}. ${item.team.abbrev} - ${item.pick.round === 1 ? "1st" : "2nd"} round (${item.pick.season})`,
		);
		console.log(`   Pick value: ${item.pickValue.toFixed(2)}`);
		console.log(`   Negative players: ${item.negativePlayers.length}`);
		console.log(`   Total trade value: ${item.valueChange.toFixed(2)}`);
		console.log("");
	});
}

await findMostValuablePicks();

// Find teams willing to give up their lowest 1st or 2nd round pick plus all negative value players for nothing
// Run in the worker console at any phase

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
