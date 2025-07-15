// Run in the worker console during the expansion draft.

const ordinal = (x) => {
	if (x == null) return "";
	if (x % 100 >= 11 && x % 100 <= 13) return x + "th";
	return x + (["th", "st", "nd", "rd"][Math.min(x % 10, 4)] || "th");
};
const deepCopy = (obj) => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));

async function getExpansionDraftOrder() {
	const picks = await bbgm.idb.cache.draftPicks.indexGetAll(
		"draftPicksBySeason",
		"expansion",
	);
	return picks.sort((a, b) => a.round - b.round || a.pick - b.pick);
}

async function getAvailableExpansionPlayers() {
	const { availablePids } = bbgm.g.get("expansionDraft");
	const all = await bbgm.idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	return all.filter((p) => availablePids.includes(p.pid));
}

async function draftExpansionPlayer(pick, player) {
	const prevTid = player.tid,
		expansionDraft = bbgm.g.get("expansionDraft");
	player.tid = pick.tid;
	const isExpansion =
		bbgm.g.get("phase") === -2 && expansionDraft.phase === "draft";
	if (isExpansion) {
		const fakeP = {
			...deepCopy(player),
			prevTid,
			prevAbbrev: bbgm.g.get("teamInfoCache")[prevTid]?.abbrev,
		};
		Object.assign(fakeP, {
			draft: {
				...pick,
				year: bbgm.g.get("season"),
				pot: player.ratings.at(-1).pot,
				ovr: player.ratings.at(-1).ovr,
				skills: player.ratings.at(-1).skills,
			},
		});
		(bbgm.local.fantasyDraftResults ||= []).push(fakeP);
	} else {
		player.draft = {
			...pick,
			year: bbgm.g.get("season"),
			pot: player.ratings[0].pot,
			ovr: player.ratings[0].ovr,
			skills: player.ratings[0].skills,
		};
	}
	(player.transactions ||= []).push({
		season: bbgm.g.get("season"),
		phase: bbgm.g.get("phase"),
		tid: player.tid,
		type: "draft",
		pickNum:
			pick.pick +
			(pick.round - 1) *
				(isExpansion
					? expansionDraft.expansionTids.length
					: bbgm.g.get("numActiveTeams")),
	});
	if (isExpansion) {
		const n = (expansionDraft.numPerTeamDrafted?.[prevTid] ?? 0) + 1;
		await bbgm.g.setWithoutSavingToDB("expansionDraft", {
			...expansionDraft,
			numPerTeamDrafted: { ...expansionDraft.numPerTeamDrafted, [prevTid]: n },
			availablePids: expansionDraft.availablePids.filter(
				(pid2) => player.pid !== pid2,
			),
		});
	}
	await bbgm.idb.cache.players.put(player);
	await bbgm.idb.cache.draftPicks.delete(pick.dpid);
	console.log(
		`Drafted ${player.firstName} ${player.lastName} (pid ${player.pid}) from team ${prevTid} with the ${ordinal(pick.pick)} pick.`,
	);
}

await (async function autoDraftBestExpansionPlayers(numPicks = 10) {
	const available = await getAvailableExpansionPlayers();
	// Map from tid to best player from that team
	const bestByTeam = new Map();
	for (const p of available.sort((a, b) => b.valueFuzz - a.valueFuzz)) {
		if (!bestByTeam.has(p.tid)) bestByTeam.set(p.tid, p);
		if (bestByTeam.size >= numPicks) break;
	}
	const pickedPlayers = Array.from(bestByTeam.values()).slice(0, numPicks);
	if (pickedPlayers.length < numPicks)
		console.log(
			`Warning: Only found ${pickedPlayers.length} unique teams to pick from.`,
		);
	for (const player of pickedPlayers) {
		const [pick] = await getExpansionDraftOrder();
		if (!pick) break;
		await draftExpansionPlayer(pick, player);
	}
	console.log("Auto-draft complete.");
})();
