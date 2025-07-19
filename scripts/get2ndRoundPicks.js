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

		// Find the most valuable pick by testing each one with valueChange
		let mostValuablePick = null;
		let largestDv = -Infinity;

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
				// Flip the sign: negative dv means pick is valuable, positive dv means pick is less valuable
				const pickValue = -dv;
				if (pickValue > 0 && pickValue > largestDv) {
					mostValuablePick = pickOption;
					largestDv = pickValue;
				}
			} catch (e) {
				// Ignore errors
			}
		}

		if (!mostValuablePick) {
			continue;
		}

		try {
			const dv = await bbgm.team.valueChange(
				team.tid,
				[],
				negativePlayers.map((p) => p.pid),
				[],
				[mostValuablePick.dpid],
				undefined,
				userTid,
				playersToOffer.map((p) => p.pid),
			);
			if (dv > 0) {
				teamsWithViableTrades++;
				availablePicks.push({
					team: team,
					pick: mostValuablePick,
					negativePlayers: negativePlayers,
					valueChange: dv,
					pickValue: largestDv,
				});
			}
		} catch (e) {
			// Ignore errors
		}
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
