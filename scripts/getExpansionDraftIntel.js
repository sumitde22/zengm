async function getPlayerValue(pid, strategy) {
	const p = await bbgm.idb.cache.players.get(pid);
	let playerValue =
		(p.value - bbgm.local.playerOvrMean) / bbgm.local.playerOvrStd;
	const contractValue = await getContractValue(p.contract, playerValue);
	if (strategy === "rebuilding") {
		if (p.age <= 19) {
			playerValue *= 1.075;
		} else if (p.age === 20) {
			playerValue *= 1.05;
		} else if (p.age === 21) {
			playerValue *= 1.0375;
		} else if (p.age === 22) {
			playerValue *= 1.025;
		} else if (p.age === 23) {
			playerValue *= 1.0125;
		} else if (p.age === 27) {
			playerValue *= 0.975;
		} else if (p.age === 28) {
			playerValue *= 0.95;
		} else if (p.age >= 29) {
			playerValue *= 0.9;
		}
	} else if (strategy === "contending") {
		if (p.age <= 19) {
			playerValue *= 0.8;
		} else if (p.age === 20) {
			playerValue *= 0.825;
		} else if (p.age === 21) {
			playerValue *= 0.85;
		} else if (p.age === 22) {
			playerValue *= 0.875;
		} else if (p.age === 23) {
			playerValue *= 0.925;
		} else if (p.age === 24) {
			playerValue *= 0.95;
		}
	}
	const contractsFactor = strategy === "rebuilding" ? 2 : 0.5;
	playerValue += contractsFactor * contractValue;
	return playerValue > 1 ? playerValue ** 7 : playerValue;
}

async function getContractValue(contract, normalizedValue) {
	const season = bbgm.g.get("season");
	const phase = bbgm.g.get("phase");
	if (contract.exp === season || (phase > 3 && contract.exp === season + 1)) {
		return 0;
	}

	const salaryCap = bbgm.g.get("salaryCap");
	const normalizedContractAmount = contract.amount / salaryCap;

	const slope =
		(bbgm.g.get("maxContract") / salaryCap -
			bbgm.g.get("minContract") / salaryCap) /
		2.5;

	const expectedAmount = slope * (normalizedValue + 0.5);

	const contractValue = expectedAmount - normalizedContractAmount;

	return Math.min(contractValue, 0.1);
}

async function getExpansionDraftIntel() {
	const { availablePids } = bbgm.g.get("expansionDraft");
	const all = await bbgm.idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const eligible_players = all.filter((p) => availablePids.includes(p.pid));
	let rebuildingPlayerValues = [];
	let contendingPlayerValues = [];
	for (const p of eligible_players) {
		rebuildingPlayerValues.push({
			id: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			tid: p.tid,
			value: await getPlayerValue(p.pid, "rebuilding"),
		});
		contendingPlayerValues.push({
			id: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			tid: p.tid,
			value: await getPlayerValue(p.pid, "contending"),
		});
	}
	rebuildingPlayerValues.sort((p1, p2) => p2.value - p1.value);
	contendingPlayerValues.sort((p1, p2) => p2.value - p1.value);
	console.log("Player Value Leaderboard:");
	for (let i = 0; i < 20; i++) {
		console.log(
			`${rebuildingPlayerValues[i].name}, ${rebuildingPlayerValues[i].value.toPrecision(4)} ||| ${contendingPlayerValues[i].name}, ${contendingPlayerValues[i].value.toPrecision(4)}`,
		);
		if (i == 9) {
			console.log("----------------------------------------");
		}
	}
}

await getExpansionDraftIntel();
