// Run in the worker console during the expansion draft.

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
	const prevTid = player.tid;
	const expansionDraft = bbgm.g.get("expansionDraft");
	player.tid = pick.tid;

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

	(player.transactions ||= []).push({
		season: bbgm.g.get("season"),
		phase: bbgm.g.get("phase"),
		tid: player.tid,
		type: "draft",
		pickNum: pick.pick + (pick.round - 1) * expansionDraft.expansionTids.length,
	});

	const n = (expansionDraft.numPerTeamDrafted?.[prevTid] ?? 0) + 1;
	await bbgm.g.setWithoutSavingToDB("expansionDraft", {
		...expansionDraft,
		numPerTeamDrafted: { ...expansionDraft.numPerTeamDrafted, [prevTid]: n },
		availablePids: expansionDraft.availablePids.filter(
			(pid2) => player.pid !== pid2,
		),
	});

	await bbgm.idb.cache.players.put(player);
	await bbgm.idb.cache.draftPicks.delete(pick.dpid);
	console.log(
		`Drafted ${player.firstName} ${player.lastName} (pid ${player.pid}) from team ${prevTid}.`,
	);
}

// Auto-draft all remaining expansion draft picks
while (true) {
	const picks = await getExpansionDraftOrder();
	if (picks.length === 0) {
		break;
	}
	const available = await getAvailableExpansionPlayers();
	if (available.length === 0) {
		console.log("No available players left to draft.");
		break;
	}
	// Pick the best available player (by valueFuzz)
	const bestPlayer = available.sort((a, b) => b.valueFuzz - a.valueFuzz)[0];
	const pick = picks[0];
	await draftExpansionPlayer(pick, bestPlayer);
}

// Finalize expansion draft and set phase to AFTER_DRAFT
await bbgm.g.setWithoutSavingToDB("expansionDraft", { phase: "setup" });
await bbgm.g.setWithoutSavingToDB("phase", bbgm.PHASE.AFTER_DRAFT);
await bbgm.toUI("realtimeUpdate", [["gameAttributes"], "/"]);
console.log(
	"Expansion draft complete. Phase set to AFTER_DRAFT. Please reload the page and advance to preseason in the UI as normal.",
);
