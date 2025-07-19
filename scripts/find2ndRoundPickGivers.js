// Find teams willing to give up their most valuable 1st or 2nd round pick plus all negative value players for nothing

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

async function findWillingTeams() {
	const userTid = bbgm.g.get("userTid");
	const teams = (await bbgm.idb.cache.teams.getAll()).filter(
		(t) => t.tid !== userTid && !t.disabled,
	);
	const season = bbgm.g.get("season");
	const userPlayers = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		userTid,
	);
	const expiringPlayers = userPlayers.filter(
		(p) =>
			p.contract.exp === season &&
			p.value >= 0 &&
			!bbgm.trade.isUntradable(p).untradable,
	);

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

		// Find the least valuable pick by testing each one with valueChange
		let leastValuablePick = null;
		let smallestDv = Infinity;

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
				if (pickValue > 0 && pickValue < smallestDv) {
					leastValuablePick = pickOption;
					smallestDv = pickValue;
				}
			} catch (e) {
				// Ignore errors
			}
		}

		if (!leastValuablePick) {
			continue;
		}

		try {
			const dv = await bbgm.team.valueChange(
				team.tid,
				[],
				negativePlayers.map((p) => p.pid),
				[],
				[leastValuablePick.dpid],
				undefined,
				userTid,
				expiringPlayers.map((p) => p.pid),
			);
			if (dv > 0) {
				console.log(
					`Team ${team.abbrev} is willing to trade a 1st/2nd round pick plus negative value players for your expiring contracts.`,
				);
			}
		} catch (e) {
			// Ignore errors
		}
	}
}

await findWillingTeams();
