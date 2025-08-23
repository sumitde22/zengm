// algorithm :
// 0. prefetch per pick run - top gettable pick,
// 1. dijkstra's to find cheapest path to top pick
//      to cache - each team pick value, strategy, total negative value
//      for each pick, try trade to all higher picks within range
//      if possible, only then run subset sum
//      slow build path
// 2. once path set, go through and execute, filter out our salaries/values too large and forward select to get off some contracts if possible
// recursively do for all current picks
// then try to get free picks

function getMockTeamIds(teams) {
	let rebuildingTeamId = null;
	let contendingTeamId = null;
	for (let i = 0; i < teams.length; i++) {
		if (teams[i].strategy === "rebuilding") {
			rebuildingTeamId = teams[i].tid;
		} else if (teams[i].strategy === "contending") {
			contendingTeamId = teams[i].tid;
		}
		if (rebuildingTeamId !== null && contendingTeamId !== null) {
			break;
		}
	}
	return [rebuildingTeamId, contendingTeamId];
}

async function getDraftPicks() {
	let draftPicks = await bbgm.idb.cache.draftPicks.getAll();
	return draftPicks
		.filter((pick) => pick.season === season)
		.sort((pick1, pick2) => {
			if (pick1.round !== pick2.round) {
				return pick1.round - pick2.round;
			}
			return pick1.pick - pick2.pick;
		});
}

// (myDraftPicks[i].round - 1) * numTeams + myDraftPicks[i].pick - 1
async function getTopGettablePicks(season, userTid) {
	const teams = await bbgm.idb.cache.teams.getAll();
	const draftPicks = await getDraftPicks();
	const myDraftPicks = draftPicks.filter((pick) => pick.tid === userTid);
	const [rebuildingTeamId, contendingTeamId] = getMockTeamIds(teams);
}

async function getPickInformation(season, userTid) {
	const pickValues = [];
	const negativePlayerValueOnTeam = {};
	const teams = await bbgm.idb.cache.teams.getAll();
	const numTeams = teams.length;
	for (const team of teams) {
		let picks = await bbgm.idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			team.tid,
		);
		picks = picks.filter((pick) => pick.season === season);
		for (let i = 0; i < picks.length; i++) {
			const pick = picks[i];
			let pickValue = await bbgm.team.valueChange(
				team.tid,
				[],
				[],
				[],
				[pick.dpid],
				undefined,
				userTid,
				[],
			);
			pickValue = pickValue.toFixed(4) * -1;
			pickValues[(pick.round - 1) * numTeams + pick.pick - 1] = pickValue;
		}
		negativePlayerValueOnTeam[team.tid] = 0;
		let players = await bbgm.idb.cache.players.indexGetAll(
			"playersByTid",
			team.tid,
		);
		players = players.filter((player) => player.contract.exp !== season);
		for (const player of players) {
			const playerValue = await bbgm.team.valueChange(
				team.tid,
				[],
				[player.pid],
				[],
				[],
				undefined,
				userTid,
				[],
			);
			if (playerValue >= 0) {
				console.log(
					`${player.firstName} ${player.lastName}, ${playerValue.toFixed(4)}`,
				);
				negativePlayerValueOnTeam[team.tid] += playerValue;
			}
		}
	}
	console.log(pickValues);
	console.log(negativePlayerValueOnTeam);
}

async function draftTradeUp() {
	const userTid = bbgm.g.get("userTid");
	const season = bbgm.g.get("season");
	await getTopGettablePicks(season, userTid);
}

await draftTradeUp();
