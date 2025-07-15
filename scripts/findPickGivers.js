async function findPickGivers() {
	const userTid = bbgm.g.get("userTid");
	const teams = await bbgm.idb.cache.teams.getAll();
	for (const team of teams) {
		const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		if (picks.length === 0) {
			continue;
		}
		let cheapestDv = -10000000;
		let cheapestDpid = null;
		for (let i = 0; i < picks.length; i++) {
			const dv = await bbgm.team.valueChange(
				team.tid,
				[],
				[],
				[],
				[picks[i].dpid],
				undefined,
				userTid,
				[],
			);
			if (dv > cheapestDv) {
				cheapestDv = dv;
				cheapestDpid = picks[i].dpid;
			}
		}
		if (cheapestDpid === null) {
			continue;
		}
		const negativePlayers = [];
		const players = await bbgm.idb.cache.players.indexGetAll(
			"playersByTid",
			team.tid,
		);
		for (let i = 0; i < players.length; i++) {
			const dv = await bbgm.team.valueChange(
				team.tid,
				[],
				[players[i].pid],
				[],
				[],
				undefined,
				userTid,
				[],
			);
			if (dv > 0) {
				negativePlayers.push(players[i].pid);
			}
		}
		const testDv = await bbgm.team.valueChange(
			team.tid,
			[],
			negativePlayers,
			[],
			[cheapestDpid],
			undefined,
			userTid,
			[],
		);
		if (testDv > 0) {
			console.log(`Team found: ${team.region} ${team.name}`);
		}
	}
}

await findPickGivers();
