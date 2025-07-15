// algorithm :
// 0. prefetch per pick run - top gettable pick,
// 		from dpid - find index, iterate all the way left.
// 		if negative contracts on team exceed different in pick value, valid, set as running highest
// 1. dijkstra's to find cheapest path to top pick
//      to cache - each team pick value, strategy, total negative value
//      for each pick, try trade to all higher picks within range
//      if possible, only then run subset sum
//      slow build path
// 2. once path set, go through and execute,
// 		at each step, filter out our salaries/values too large and forward select to get off some contracts if possible
//		at each step, try to sub in lower picks if possible, try to optimize
// recursively do this for all current picks
// then try to get free picks, and recursively run for any of these picks

const NUM_ROUNDS = 2;

async function getDraftPicks(season) {
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

async function possibleTradeUp(candidateDp, dp, season) {
	const userTid = bbgm.g.get("userTid");
	if (userTid == candidateDp.tid) return false;
	const negativePids = [];
	let players = await bbgm.idb.cache.players.indexGetAll(
		"playersByTid",
		candidateDp.tid,
	);
	players = players.filter((player) => player.contract.exp !== season);
	for (const player of players) {
		const playerValue = await bbgm.team.valueChange(
			candidateDp.tid,
			[],
			[player.pid],
			[],
			[],
			undefined,
			userTid,
			[],
		);
		if (playerValue > 0) negativePids.push(player.pid);
	}
	const totalValueChange = await bbgm.team.valueChange(
		candidateDp.tid,
		[],
		negativePids,
		[dp.dpid],
		[candidateDp.dpid],
		undefined,
		userTid,
		[],
	);
	return totalValueChange > 0;
}

async function getTopGettablePick(dp, draftPicks, season) {
	let bestDp = dp;
	for (
		let i = (dp.round - 1) * (draftPicks.length / NUM_ROUNDS) + dp.pick - 2;
		i >= 0;
		i--
	) {
		const tradeUpFound = await possibleTradeUp(draftPicks[i], bestDp, season);
		if (tradeUpFound) bestDp = draftPicks[i];
	}
	return bestDp;
}

function minSubsetSumAtLeastK(players, k) {
	let bestSum = Infinity;
	let bestSubset = [];

	// Step 1: handle single players with value >= k
	for (let p of players) {
		if (p.value >= k) {
			if (p.value < bestSum || (p.value === bestSum && 1 < bestSubset.length)) {
				bestSum = p.value;
				bestSubset = [p];
			}
		}
	}

	// Step 2: subset search on players with value < k
	const smallPlayers = players.filter((p) => p.value < k);
	const n = smallPlayers.length;

	for (let mask = 1; mask < 1 << n; mask++) {
		let sum = 0;
		let subset = [];
		for (let i = 0; i < n; i++) {
			if (mask & (1 << i)) {
				sum += smallPlayers[i].value;
				subset.push(smallPlayers[i]);
			}
		}
		if (
			sum >= k &&
			(sum < bestSum || (sum === bestSum && subset.length < bestSubset.length))
		) {
			bestSum = sum;
			bestSubset = subset;
		}
	}

	return bestSubset;
}

async function findTradeUpPath(draftPicks, currentDp, targetDp) {
	const relevantDraftPicks = draftPicks.filter(
		(dp) =>
			targetDp.round <= dp.round <= currentDp.round &&
			targetDp.pick <= dp.pick <= currentDp.pick,
	);
	console.log(relevantDraftPicks);
}

async function draftTradeUp() {
	const userTid = bbgm.g.get("userTid");
	const season = bbgm.g.get("season");
	const draftPicks = await getDraftPicks(season);
	const myDraftPicks = draftPicks.filter((pick) => pick.tid === userTid);
	const bestDp = await getTopGettablePick(myDraftPicks[1], draftPicks, season);
	console.log(
		`Final best: round ${myDraftPicks[1].round} pick ${myDraftPicks[1].pick} -> round ${bestDp.round} pick ${bestDp.pick}`,
	);
	const tradeUpPath = findTradeUpPath(draftPicks, myDraftPicks[1], bestDp);
}

await draftTradeUp();

// function getMockTeamIds(teams) {
// 	let rebuildingTeamId = null;
// 	let contendingTeamId = null;
// 	for (let i = 0; i < teams.length; i++) {
// 		if (teams[i].strategy === "rebuilding") {
// 			rebuildingTeamId = teams[i].tid;
// 		} else if (teams[i].strategy === "contending") {
// 			contendingTeamId = teams[i].tid;
// 		}
// 		if (rebuildingTeamId !== null && contendingTeamId !== null) {
// 			break;
// 		}
// 	}
// 	return [rebuildingTeamId, contendingTeamId];
// }
